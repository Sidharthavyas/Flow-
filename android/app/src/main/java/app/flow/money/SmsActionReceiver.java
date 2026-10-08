package app.flow.money;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A button on a payment notification ("Food", "Not spending"…): sends the answer to Flow, then shows the outcome. */
public class SmsActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!SmsSync.ACTION_RESOLVE.equals(intent.getAction())) return;
        String expenseId = intent.getStringExtra(SmsSync.EXTRA_EXPENSE);
        String kind = intent.getStringExtra(SmsSync.EXTRA_KIND);
        String category = intent.getStringExtra(SmsSync.EXTRA_CATEGORY);
        int notificationId = intent.getIntExtra(SmsSync.EXTRA_NOTIFICATION, 0);
        if (expenseId == null || kind == null) return;

        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                String message = SmsSync.resolve(expenseId, kind, category);
                SmsSync.showOutcome(app, notificationId, message != null ? message : "Couldn't save. It's waiting in Flow → To review");
            } finally {
                pending.finish();
            }
        }).start();
    }
}
