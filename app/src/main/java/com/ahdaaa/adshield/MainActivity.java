package com.ahdaaa.adshield;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.VpnService;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import java.text.NumberFormat;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_VPN = 1;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final NumberFormat numbers = NumberFormat.getInstance();
    private long drawnVersion = -1;

    private Button toggle;
    private TextView statusText, blockedCount, queryCount, listInfo;
    private View advanced;
    private Button advancedToggle;
    private LinearLayout recentList;
    private EditText allowEdit, blockEdit;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        toggle = findViewById(R.id.toggle);
        statusText = findViewById(R.id.status);
        blockedCount = findViewById(R.id.blocked_count);
        queryCount = findViewById(R.id.query_count);
        listInfo = findViewById(R.id.list_info);
        advanced = findViewById(R.id.advanced);
        advancedToggle = findViewById(R.id.advanced_toggle);
        recentList = findViewById(R.id.recent_list);
        allowEdit = findViewById(R.id.allow_edit);
        blockEdit = findViewById(R.id.block_edit);

        toggle.setOnClickListener(v -> {
            if (Stats.running) AdBlockService.stop(this);
            else turnOn();
        });
        advancedToggle.setOnClickListener(v -> {
            boolean show = advanced.getVisibility() != View.VISIBLE;
            advanced.setVisibility(show ? View.VISIBLE : View.GONE);
            advancedToggle.setText(show ? R.string.hide_advanced : R.string.show_advanced);
            drawnVersion = -1;
        });

        setUpSources();
        setUpUpstreams();
        allowEdit.setText(Lists.userAllow(this));
        blockEdit.setText(Lists.userBlock(this));
        findViewById(R.id.save_rules).setOnClickListener(v -> {
            Lists.setUserLists(this, allowEdit.getText().toString(), blockEdit.getText().toString());
            AdBlockService.reload(this);
            Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
        });
        findViewById(R.id.update_now).setOnClickListener(v -> updateListsNow());
        findViewById(R.id.always_on).setOnClickListener(v -> {
            try {
                startActivity(new Intent(Settings.ACTION_VPN_SETTINGS));
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
            }
        });

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 2);
        }
    }

    private void turnOn() {
        Intent consent = VpnService.prepare(this);
        if (consent != null) {
            // First time only: Android asks the user to allow the (local) VPN.
            startActivityForResult(consent, REQ_VPN);
        } else {
            onActivityResult(REQ_VPN, RESULT_OK, null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_VPN) return;
        if (resultCode == RESULT_OK) {
            AdBlockService.start(this);
        } else {
            Toast.makeText(this, R.string.vpn_denied, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        drawnVersion = -1;
        tick.run();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(tick);
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            render();
            handler.postDelayed(this, 1000);
        }
    };

    private void render() {
        long v = Stats.version.get();
        if (v == drawnVersion) return;
        drawnVersion = v;

        boolean on = Stats.running;
        toggle.setText(on ? R.string.toggle_on : R.string.toggle_off);
        toggle.setBackgroundResource(on ? R.drawable.circle_on : R.drawable.circle_off);
        statusText.setText(on ? Stats.status : getString(R.string.status_off));
        blockedCount.setText(numbers.format(Stats.blocked.get()));
        queryCount.setText(getString(R.string.query_count, numbers.format(Stats.queries.get())));

        long updated = Lists.lastUpdated(this);
        String when = updated == 0 ? getString(R.string.never)
                : DateUtils.getRelativeTimeSpanString(updated).toString();
        listInfo.setText(on
                ? getString(R.string.list_info, numbers.format(Stats.listSize), when)
                : getString(R.string.list_info_off, when));

        if (advanced.getVisibility() == View.VISIBLE) renderRecent();
    }

    private void renderRecent() {
        recentList.removeAllViews();
        List<Stats.Entry> entries = Stats.recent();
        if (entries.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText(R.string.recent_empty);
            recentList.addView(empty);
            return;
        }
        int pad = (int) (6 * getResources().getDisplayMetrics().density);
        for (int i = 0; i < Math.min(entries.size(), 60); i++) {
            Stats.Entry e = entries.get(i);
            TextView row = new TextView(this);
            row.setText((e.blocked ? "⛔  " : "✓  ") + e.domain);
            row.setTextColor(e.blocked ? Color.rgb(0xE5, 0x39, 0x35) : statusText.getCurrentTextColor());
            row.setPadding(0, pad, 0, pad);
            row.setOnClickListener(x -> askRule(e));
            recentList.addView(row);
        }
    }

    private void askRule(Stats.Entry e) {
        new AlertDialog.Builder(this)
                .setTitle(e.domain)
                .setMessage(e.blocked ? R.string.ask_allow : R.string.ask_block)
                .setPositiveButton(e.blocked ? R.string.allow : R.string.block, (d, w) -> {
                    Lists.addUserRule(this, e.domain, !e.blocked);
                    allowEdit.setText(Lists.userAllow(this));
                    blockEdit.setText(Lists.userBlock(this));
                    AdBlockService.reload(this);
                    Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    private void setUpSources() {
        LinearLayout box = findViewById(R.id.sources);
        for (Lists.Source s : Lists.SOURCES) {
            CheckBox cb = new CheckBox(this);
            cb.setText(s.name + "\n" + s.description);
            cb.setChecked(Lists.isSourceEnabled(this, s));
            cb.setOnCheckedChangeListener((b, checked) -> {
                Lists.setSourceEnabled(this, s, checked);
                if (checked) updateListsNow();
                else AdBlockService.reload(this);
            });
            box.addView(cb);
        }
    }

    private void setUpUpstreams() {
        RadioGroup group = findViewById(R.id.upstreams);
        int selected = Lists.upstreamIndex(this);
        for (int i = 0; i < Lists.UPSTREAMS.length; i++) {
            RadioButton rb = new RadioButton(this);
            rb.setId(View.generateViewId());
            rb.setText(Lists.UPSTREAMS[i].name);
            group.addView(rb);
            if (i == selected) rb.setChecked(true);
            int index = i;
            rb.setOnCheckedChangeListener((b, checked) -> {
                if (!checked) return;
                Lists.setUpstreamIndex(this, index);
                AdBlockService.reload(this);
            });
        }
    }

    private void updateListsNow() {
        Toast.makeText(this, R.string.updating, Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            int ok = Lists.downloadAll(getApplicationContext());
            runOnUiThread(() -> {
                Toast.makeText(this, ok > 0 ? R.string.update_ok : R.string.update_failed, Toast.LENGTH_SHORT).show();
                AdBlockService.reload(this);
                drawnVersion = -1;
            });
        }).start();
    }
}
