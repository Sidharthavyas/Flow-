package app.flow.money;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * Twice-daily check-in (1 PM and 9 PM): asks the Flow web app for the roast or praise (using the WebView's
 * login cookie) and shows it as a notification. Quiet days, logged-out users and network failures show nothing.
 */
public class NudgeReceiver extends BroadcastReceiver {
    private static final String ACTION_NUDGE = "app.flow.money.DAILY_NUDGE";
    private static final String EXTRA_SLOT = "slot";
    private static final String CHANNEL_ID = "flow_daily_nudge";
    private static final String PREFS = "flow_nudges";
    private static final String PREF_TESTED_VERSION = "tested_version";
    private static final int NOTIFICATION_ID = 2100;
    // slot name, hour of day; each slot has its own alarm (request code = index).
    private static final String[] SLOTS = {"afternoon", "evening"};
    private static final int[] SLOT_HOURS = {13, 21};
    private static final int TEST_REQUEST_CODE = 99;

    public static void schedule(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        for (int i = 0; i < SLOTS.length; i++) {
            Calendar next = Calendar.getInstance();
            next.set(Calendar.HOUR_OF_DAY, SLOT_HOURS[i]);
            next.set(Calendar.MINUTE, 0);
            next.set(Calendar.SECOND, 0);
            next.set(Calendar.MILLISECOND, 0);
            if (next.getTimeInMillis() <= System.currentTimeMillis() + 60_000) next.add(Calendar.DAY_OF_YEAR, 1);
            // Inexact but allowed in Doze: no exact-alarm permission needed, and a few minutes' drift is fine.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), nudgeIntent(context, SLOTS[i], i));
        }
    }

    /** Once per installed version, sends a test notification shortly after launch so the setup can be checked. */
    public static void scheduleTestOnce(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (BuildConfig.VERSION_NAME.equals(prefs.getString(PREF_TESTED_VERSION, ""))) return;
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 30_000, nudgeIntent(context, "test", TEST_REQUEST_CODE));
        prefs.edit().putString(PREF_TESTED_VERSION, BuildConfig.VERSION_NAME).apply();
    }

    private static PendingIntent nudgeIntent(Context context, String slot, int requestCode) {
        Intent intent = new Intent(context, NudgeReceiver.class).setAction(ACTION_NUDGE).putExtra(EXTRA_SLOT, slot);
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        schedule(context);
        if (!ACTION_NUDGE.equals(intent.getAction())) return; // boot / app update: just re-arm the alarms
        String slot = intent.getStringExtra(EXTRA_SLOT);
        String requestSlot = slot == null ? "evening" : slot;

        String cookie;
        try {
            cookie = CookieManager.getInstance().getCookie(BuildConfig.APP_URL);
        } catch (RuntimeException e) {
            return; // WebView unavailable on this device right now
        }
        if (cookie == null || cookie.isEmpty()) return;

        Context appContext = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                JSONObject nudge = fetchNudge(cookie, requestSlot);
                if (nudge != null && nudge.optBoolean("show")) show(appContext, nudge.optString("title"), nudge.optString("body"));
            } catch (Exception ignored) {
                // Offline or server hiccup: skip today rather than show something wrong.
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static JSONObject fetchNudge(String cookie, String slot) throws Exception {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.APP_URL + "/api/nudge?date=" + today + "&slot=" + slot).openConnection();
        try {
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "FlowAndroid/" + BuildConfig.VERSION_NAME);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                for (int n; (n = in.read(buffer)) != -1; ) out.write(buffer, 0, n);
                return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void show(Context context, String title, String body) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || body.isEmpty()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, context.getString(R.string.nudge_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription(context.getString(R.string.nudge_channel_description));
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_stat_flow)
                .setColor(context.getColor(R.color.flow_accent))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true);
        try {
            manager.notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission was denied.
        }
    }
}
