// «Поделиться → ФИНИК» (во всех сборках, без новых разрешений): приложение
// появляется в системном меню «Поделиться» для текста. JS забирает текст через
// NativeModules.FinikShare.consume() и разбирает его как банковское сообщение.
const { withAndroidManifest, withMainActivity, AndroidConfig } = require('@expo/config-plugins');
const { withReactPackage, withKotlinFiles } = require('./_shared');

const MODULE = `package com.familybudget.share

import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class ShareTextModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "FinikShare"

  // Текст, присланный через «Поделиться», — один раз (потом интент очищается)
  @ReactMethod
  fun consume(promise: Promise) {
    val intent = currentActivity?.intent
    if (intent == null || intent.action != Intent.ACTION_SEND) { promise.resolve(null); return }
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    intent.action = Intent.ACTION_MAIN
    intent.removeExtra(Intent.EXTRA_TEXT)
    intent.removeExtra(Intent.EXTRA_SUBJECT)
    promise.resolve(listOfNotNull(subject, text).joinToString("\\n").ifBlank { null })
  }
}

class ShareTextPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(ShareTextModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

module.exports = function withShareText(config) {
  config = withAndroidManifest(config, cfg => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity['intent-filter'] = activity['intent-filter'] || [];
    const has = activity['intent-filter'].some(f => (f.action || []).some(a => a.$['android:name'] === 'android.intent.action.SEND'));
    if (!has) {
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'text/plain' } }],
      });
    }
    return cfg;
  });
  // Уже запущенное приложение получает «Поделиться» через onNewIntent — сохраняем
  // новый интент, иначе consume() увидит старый
  config = withMainActivity(config, cfg => {
    let src = cfg.modResults.contents;
    if (!src.includes('onNewIntent')) {
      src = src.replace(/class MainActivity : ReactActivity\(\) \{/, `class MainActivity : ReactActivity() {
  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }
`);
      cfg.modResults.contents = src;
    }
    return cfg;
  });
  config = withKotlinFiles(config, 'com.familybudget.share', { 'ShareText.kt': MODULE });
  return withReactPackage(config, 'com.familybudget.share.ShareTextPackage');
};
