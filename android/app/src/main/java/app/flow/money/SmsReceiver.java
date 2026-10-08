package app.flow.money;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Receives new SMS (only after the user turns on "Auto-add from bank SMS" and grants permission). Everything that is not
 * a bank transaction from a bank sender ID is ignored on the phone and never sent anywhere.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction()) || !SmsSync.isEnabled(context)) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;

        // Long SMS arrive in parts; join them per sender.
        Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        Map<String, Long> times = new LinkedHashMap<>();
        for (SmsMessage part : parts) {
            if (part == null) continue;
            String sender = part.getDisplayOriginatingAddress();
            if (sender == null) continue;
            StringBuilder body = bodies.get(sender);
            if (body == null) {
                body = new StringBuilder();
                bodies.put(sender, body);
                times.put(sender, part.getTimestampMillis());
            }
            body.append(part.getDisplayMessageBody());
        }

        boolean queued = false;
        for (Map.Entry<String, StringBuilder> entry : bodies.entrySet()) {
            String sender = entry.getKey(), body = entry.getValue().toString();
            if (!SmsSync.looksLikeBankSms(sender, body)) continue;
            Long time = times.get(sender);
            SmsSync.enqueue(context, sender, SmsSync.withoutBalance(body), time == null || time == 0 ? System.currentTimeMillis() : time);
            queued = true;
        }
        if (!queued) return;

        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                SmsSync.flush(app);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
