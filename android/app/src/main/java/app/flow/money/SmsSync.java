package app.flow.money;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * Bank SMS → Flow. The phone only decides "is this a bank transaction SMS?", removes the balance, and forwards it with
 * the WebView's login cookie. The server reads it, saves the expense and says what to show; the notification's buttons
 * send the user's answer back. Messages that can't be sent yet (offline, signed out) wait in a small queue.
 */
final class SmsSync {
    static final String ACTION_RESOLVE = "app.flow.money.SMS_RESOLVE";
    static final String EXTRA_EXPENSE = "expenseId";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_CATEGORY = "category";
    static final String EXTRA_NOTIFICATION = "notificationId";

    private static final String PREFS = "flow_sms";
    private static final String PREF_ENABLED = "enabled";
    private static final String PREF_QUEUE = "queue";
    private static final String CHANNEL_ID = "flow_payments";
    private static final int MAX_QUEUE = 50;
    private static final long MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000;
    private static final Object LOCK = new Object();

    // Bank and card senders are short alphanumeric IDs ("AD-HDFCBK", "JD-BOIIND-S"), never phone numbers.
    private static final Pattern BANK_SENDER = Pattern.compile("^[A-Za-z]{2}-[A-Za-z0-9]{3,9}(-[A-Za-z])?$|^[A-Za-z]{5,9}$");
    private static final Pattern MONEY = Pattern.compile("(?i)(rs\\.?|inr|₹)\\s*[\\d,]+");
    private static final Pattern TXN_WORD = Pattern.compile("(?i)\\b(debited|credited|spent|sent|paid|withdrawn|purchase)\\b");
    private static final Pattern OTP = Pattern.compile("(?i)\\b(otp|one time password|verification code)\\b");
    private static final Pattern BALANCE = Pattern.compile("(?i)(avl\\.?|aval\\.?|available|total)\\s*(bal|balance|lmt|limit)\\.?\\s*[:\\-]?\\s*(rs\\.?|inr|₹)?\\s*[\\d,]+(\\.\\d+)?");

    private SmsSync() {}

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(PREF_ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(PREF_ENABLED, enabled).apply();
    }

    static boolean looksLikeBankSms(String sender, String body) {
        if (sender == null || body == null) return false;
        String id = sender.trim();
        return BANK_SENDER.matcher(id).matches() && MONEY.matcher(body).find() && TXN_WORD.matcher(body).find() && !OTP.matcher(body).find();
    }

    /** Balances are never needed to record a payment, so they never leave the phone. */
    static String withoutBalance(String body) {
        return BALANCE.matcher(body).replaceAll("").replaceAll("\\s+", " ").trim();
    }

    static void enqueue(Context context, String sender, String body, long receivedAt) {
        synchronized (LOCK) {
            JSONArray queue = readQueue(context);
            try {
                JSONObject item = new JSONObject();
                item.put("text", body);
                item.put("sender", sender);
                item.put("receivedAt", receivedAt);
                queue.put(item);
            } catch (Exception ignored) {
                return;
            }
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, queue.length() - MAX_QUEUE); i < queue.length(); i++) trimmed.put(queue.opt(i));
            prefs(context).edit().putString(PREF_QUEUE, trimmed.toString()).apply();
        }
    }

    /** Sends everything waiting in the queue. Call from a background thread. */
    static void flush(Context context) {
        synchronized (LOCK) {
            String cookie = cookie();
            JSONArray queue = readQueue(context);
            if (queue.length() == 0 || cookie == null) return;
            JSONArray keep = new JSONArray();
            long now = System.currentTimeMillis();
            for (int i = 0; i < queue.length(); i++) {
                JSONObject item = queue.optJSONObject(i);
                if (item == null || now - item.optLong("receivedAt", now) > MAX_AGE_MS) continue;
                try {
                    Response response = post(cookie, "/api/sms/ingest", item);
                    if (response.code == HttpURLConnection.HTTP_OK) showResult(context, response.json);
                    else if (response.code == HttpURLConnection.HTTP_UNAUTHORIZED || response.code >= 500) keep.put(item); // signed out / server hiccup: retry later
                    // other 4xx: the server can't use this SMS, so drop it
                } catch (Exception offline) {
                    keep.put(item);
                }
            }
            prefs(context).edit().putString(PREF_QUEUE, keep.toString()).apply();
        }
    }

    static void flushAsync(Context context) {
        Context app = context.getApplicationContext();
        new Thread(() -> flush(app)).start();
    }

    /** The user's answer from a notification button. Returns the message to show, or null on failure. */
    static String resolve(String expenseId, String kind, String category) {
        String cookie = cookie();
        if (cookie == null) return null;
        try {
            JSONObject body = new JSONObject();
            body.put("expenseId", expenseId);
            body.put("kind", kind);
            if (category != null && !category.isEmpty()) body.put("category", category);
            Response response = post(cookie, "/api/sms/resolve", body);
            if (response.code == HttpURLConnection.HTTP_OK) return response.json.optString("message", "Saved");
            if (response.code == HttpURLConnection.HTTP_NOT_FOUND) return "Already sorted";
        } catch (Exception ignored) {
            // offline: the payment stays in Flow's To review list
        }
        return null;
    }

    private static void showResult(Context context, JSONObject result) {
        JSONObject notify = result.optJSONObject("notify");
        if (notify == null) return;
        String expenseId = result.optString("expenseId", "");
        String title = notify.optString("title", "Flow");
        int id = 3000 + ((expenseId.isEmpty() ? title : expenseId).hashCode() & 0xFFFFF);

        Notification.Builder builder = builder(context)
                .setContentTitle(title)
                .setContentText(notify.optString("body", ""))
                .setStyle(new Notification.BigTextStyle().bigText(notify.optString("body", "")))
                .setContentIntent(openApp(context, id))
                .setAutoCancel(true);

        JSONArray actions = notify.optJSONArray("actions");
        if (actions != null && !expenseId.isEmpty()) {
            for (int i = 0; i < Math.min(3, actions.length()); i++) {
                JSONObject action = actions.optJSONObject(i);
                if (action == null) continue;
                Intent intent = new Intent(context, SmsActionReceiver.class).setAction(ACTION_RESOLVE)
                        .putExtra(EXTRA_EXPENSE, expenseId)
                        .putExtra(EXTRA_KIND, action.optString("kind", "expense"))
                        .putExtra(EXTRA_CATEGORY, action.optString("category", ""))
                        .putExtra(EXTRA_NOTIFICATION, id);
                PendingIntent pending = PendingIntent.getBroadcast(context, id * 4 + i, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                builder.addAction(new Notification.Action.Builder(null, action.optString("label", "OK"), pending).build());
            }
        }
        notify(context, id, builder.build());
    }

    /** Replaces the question with the outcome, which then disappears by itself. */
    static void showOutcome(Context context, int id, String message) {
        Notification.Builder builder = builder(context).setContentTitle(message).setContentIntent(openApp(context, id)).setAutoCancel(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setTimeoutAfter(4000);
        notify(context, id, builder.build());
    }

    private static Notification.Builder builder(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (manager != null) {
                NotificationChannel channel = new NotificationChannel(CHANNEL_ID, context.getString(R.string.sms_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription(context.getString(R.string.sms_channel_description));
                manager.createNotificationChannel(channel);
            }
            builder = new Notification.Builder(context, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(context);
        }
        return builder.setSmallIcon(R.drawable.ic_stat_flow).setColor(context.getColor(R.color.flow_accent)).setOnlyAlertOnce(true);
    }

    private static PendingIntent openApp(Context context, int requestCode) {
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void notify(Context context, int id, Notification notification) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        try {
            manager.notify(id, notification);
        } catch (SecurityException ignored) {
            // Notification permission denied: the payment is still saved and shows in To review.
        }
    }

    private static String cookie() {
        try {
            String cookie = CookieManager.getInstance().getCookie(BuildConfig.APP_URL);
            return cookie == null || cookie.isEmpty() ? null : cookie;
        } catch (RuntimeException e) {
            return null; // WebView unavailable right now
        }
    }

    private static Response post(String cookie, String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.APP_URL + path).openConnection();
        try {
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "FlowAndroid/" + BuildConfig.VERSION_NAME);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = connection.getResponseCode();
            JSONObject json = new JSONObject();
            if (code == HttpURLConnection.HTTP_OK) {
                try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    for (int n; (n = in.read(buffer)) != -1; ) out.write(buffer, 0, n);
                    json = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
                }
            }
            return new Response(code, json);
        } finally {
            connection.disconnect();
        }
    }

    private static JSONArray readQueue(Context context) {
        try {
            return new JSONArray(prefs(context).getString(PREF_QUEUE, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static final class Response {
        final int code;
        final JSONObject json;

        Response(int code, JSONObject json) {
            this.code = code;
            this.json = json;
        }
    }
}
