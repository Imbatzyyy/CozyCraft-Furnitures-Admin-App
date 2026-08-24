package com.cozycraft.admin;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private boolean usesButtonNavigation;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Reapply the navigation-mode marker after a WebView reload as well as
        // during the first native-insets pass. Keeping this information native
        // avoids guessing from screen dimensions or user-agent strings.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView webView, String url) {
                super.onPageCommitVisible(webView, url);
                applyNavigationModeClass(webView);
            }
        });

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
            Insets tappableElements = windowInsets.getInsets(WindowInsetsCompat.Type.tappableElement());
            int protectedBottom = Math.max(navigationBars.bottom, mandatoryGestures.bottom);

            // A classic button bar is a full-height tappable region (normally
            // about 48dp); a gesture handle reserves a much shallower bottom
            // inset. Some Samsung builds also label their button bar as a
            // system-gesture inset, so height plus tappability is the reliable
            // cross-vendor distinction. Limit the marker to a bottom bar so a
            // landscape device with a side navigation rail is not lifted.
            int minimumButtonBarHeight = Math.round(
                32f * getResources().getDisplayMetrics().density
            );
            usesButtonNavigation = navigationBars.bottom >= minimumButtonBarHeight
                && tappableElements.bottom >= minimumButtonBarHeight;

            view.setPadding(
                navigationBars.left,
                view.getPaddingTop(),
                navigationBars.right,
                protectedBottom
            );
            applyNavigationModeClass(getBridge().getWebView());
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }

    private void applyNavigationModeClass(WebView webView) {
        if (webView == null) {
            return;
        }

        String enabled = usesButtonNavigation ? "true" : "false";
        webView.post(() -> webView.evaluateJavascript(
            "document.documentElement && document.documentElement.classList.toggle(" +
                "'cc-android-button-navigation', " + enabled + ");",
            null
        ));
    }
}
