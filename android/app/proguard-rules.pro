# The Flow web page calls these through window.FlowAndroid; keep them from being renamed or removed.
-keepclassmembers class app.flow.money.MainActivity$FlowBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
