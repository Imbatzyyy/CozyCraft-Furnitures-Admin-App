package com.cozycraft.admin;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Android's edge-to-edge window can place the Capacitor WebView behind
        // either the three-button navigation bar or the gesture handle. CSS
        // safe-area values are not reliable for those Android modes, so reserve
        // the actual native navigation inset on the activity content instead.
        // The listener runs again when the device rotates or navigation mode
        // changes, keeping the floating app dock above the system controls.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets navigationBars = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            Insets mandatoryGestures = windowInsets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures());
            int protectedBottom = Math.max(navigationBars.bottom, mandatoryGestures.bottom);
            view.setPadding(
                navigationBars.left,
                view.getPaddingTop(),
                navigationBars.right,
                protectedBottom
            );
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
