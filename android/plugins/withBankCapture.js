// Подключается только в личной сборке (см. app.config.js, APP_VARIANT=personal).
// ЛИЧНАЯ СБОРКА ONLY (APP_VARIANT=personal, см. app.config.js). Публичная сборка
// для RuStore этот плагин не подключает — в её APK нет ни разрешения на СМС, ни
// сервиса чтения уведомлений, ни этого кода.
//
// Что делает: принимает СМС от белого списка отправителей и уведомления от белого
// списка банковских приложений, сразу выбрасывает всё похожее на коды
// подтверждения и складывает остальное в локальную очередь (SharedPreferences).
// JS забирает очередь через NativeModules.FinikBank.drain() и разбирает на телефоне.
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const { withReactPackage, withKotlinFiles } = require('./_shared');

const PKG = 'com.familybudget.bank';

const QUEUE = `package ${PKG}

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Локальная очередь банковских сообщений. Тексты с кодами сюда не попадают.
object BankQueue {
  private const val PREFS = "finik_bank"
  private val SENSITIVE = Regex(
    "(никому\\\\s+не\\\\s+сообщайте|не\\\\s+сообщайте|введите\\\\s+код|код\\\\s+(подтверждения|для|:)|\\\\bкод\\\\b\\\\s*[:\\\\-]?\\\\s*\\\\d{3,}|парол|password|\\\\bcode\\\\b|\\\\bOTP\\\\b)",
    RegexOption.IGNORE_CASE)
  val DEFAULT_SENDERS = setOf("900", "VTB", "VTB24", "ВТБ", "SBERBANK", "YANDEX", "YANDEX.BANK", "YANDEXBANK")
  val DEFAULT_PACKAGES = setOf(
    "ru.sberbankmobile", "ru.vtb24.mobilebanking.android", "com.yandex.bank", "ru.yandex.bank", "com.yandex.pay")

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isSensitive(text: String) = SENSITIVE.containsMatchIn(text)

  fun senders(ctx: Context): Set<String> =
    prefs(ctx).getStringSet("senders", null)?.map { it.uppercase() }?.toSet() ?: DEFAULT_SENDERS
  fun packages(ctx: Context): Set<String> = prefs(ctx).getStringSet("packages", null) ?: DEFAULT_PACKAGES
  fun enabled(ctx: Context, kind: String) = prefs(ctx).getBoolean("on_" + kind, true)

  @Synchronized
  fun offer(ctx: Context, source: String, from: String, text: String, ts: Long) {
    val p = prefs(ctx)
    if (isSensitive(text)) {                       // код подтверждения — выбрасываем
      p.edit().putInt("dropped", p.getInt("dropped", 0) + 1).apply()
      return
    }
    val arr = JSONArray(p.getString("queue", "[]"))
    arr.put(JSONObject().put("source", source).put("from", from).put("text", text.take(500)).put("ts", ts))
    while (arr.length() > 300) arr.remove(0)
    p.edit().putString("queue", arr.toString()).apply()
  }

  // Диагностика: сколько СМС вообще дошло до ФИНИКа и от кого (только имена
  // отправителей, без текста) — видно, режет ли прошивка приём СМС
  @Synchronized
  fun noteSms(ctx: Context, senders: Collection<String>) {
    val p = prefs(ctx)
    val set = (p.getStringSet("sms_from", emptySet()) ?: emptySet()).toMutableSet()
    for (s in senders) if (set.size < 12) set.add(s.trim())
    p.edit().putInt("sms_seen", p.getInt("sms_seen", 0) + 1).putStringSet("sms_from", set).apply()
  }

  @Synchronized
  fun drain(ctx: Context): String {
    val p = prefs(ctx)
    val out = p.getString("queue", "[]") ?: "[]"
    p.edit().putString("queue", "[]").apply()
    return out
  }

  // Режим «Найти приложение банка»: запоминаем только имена пакетов, чьи
  // уведомления содержат сумму в рублях. Сам текст не сохраняется.
  fun discover(ctx: Context, pkg: String, text: String) {
    val p = prefs(ctx)
    if (System.currentTimeMillis() > p.getLong("discover_until", 0)) return
    if (!Regex("(₽|руб|RUB|\\\\d\\\\s?р\\\\b)", RegexOption.IGNORE_CASE).containsMatchIn(text)) return
    val set = (p.getStringSet("discovered", emptySet()) ?: emptySet()).toMutableSet()
    if (set.add(pkg)) p.edit().putStringSet("discovered", set).apply()
  }
}
`;

const SMS = `package ${PKG}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

// Входящие СМС: только от отправителей из белого списка (900, VTB…)
class BankSmsReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    BankQueue.noteSms(ctx, msgs.mapNotNull { it.displayOriginatingAddress })
    if (!BankQueue.enabled(ctx, "sms")) return
    val allowed = BankQueue.senders(ctx)
    val parts = LinkedHashMap<String, StringBuilder>()
    var ts = System.currentTimeMillis()
    for (m in msgs) {
      val from = m.displayOriginatingAddress ?: continue
      if (from.trim().uppercase() !in allowed) continue
      parts.getOrPut(from) { StringBuilder() }.append(m.displayMessageBody ?: "")
      ts = m.timestampMillis
    }
    for ((from, body) in parts) BankQueue.offer(ctx, "sms", from, body.toString(), ts)
  }
}
`;

const LISTENER = `package ${PKG}

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

// Уведомления банковских приложений (пакеты из белого списка)
class BankNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (!BankQueue.enabled(this, "push")) return
    val n = sbn.notification ?: return
    if ((n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
    val ex = n.extras ?: return
    val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
    val body = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: ""
    val text = (title + "\\n" + body).trim()
    if (text.isEmpty()) return
    if (sbn.packageName !in BankQueue.packages(this)) {
      BankQueue.discover(this, sbn.packageName, text)
      return
    }
    BankQueue.offer(this, "push", sbn.packageName, text, sbn.postTime)
  }
}
`;

const MODULE = `package ${PKG}

import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject

class BankModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "FinikBank"
  private fun prefs() = ctx.getSharedPreferences("finik_bank", 0)

  @ReactMethod fun drain(promise: Promise) = promise.resolve(BankQueue.drain(ctx))

  @ReactMethod fun status(promise: Promise) {
    val p = prefs()
    val o = JSONObject()
      .put("notificationAccess", NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName))
      .put("sms", BankQueue.enabled(ctx, "sms"))
      .put("push", BankQueue.enabled(ctx, "push"))
      .put("dropped", p.getInt("dropped", 0))
      .put("senders", JSONArray(BankQueue.senders(ctx).toList()))
      .put("packages", JSONArray(BankQueue.packages(ctx).toList()))
      .put("discovered", JSONArray((p.getStringSet("discovered", emptySet()) ?: emptySet()).toList()))
      .put("discoverUntil", p.getLong("discover_until", 0))
      .put("smsSeen", p.getInt("sms_seen", 0))
      .put("smsFrom", JSONArray((p.getStringSet("sms_from", emptySet()) ?: emptySet()).toList()))
    promise.resolve(o.toString())
  }

  @ReactMethod fun setEnabled(kind: String, on: Boolean) { prefs().edit().putBoolean("on_" + kind, on).apply() }

  @ReactMethod fun setSenders(list: ReadableArray) {
    prefs().edit().putStringSet("senders", (0 until list.size()).mapNotNull { list.getString(it)?.trim()?.uppercase() }.toSet()).apply()
  }

  @ReactMethod fun setPackages(list: ReadableArray) {
    prefs().edit().putStringSet("packages", (0 until list.size()).mapNotNull { list.getString(it)?.trim() }.toSet()).apply()
  }

  @ReactMethod fun startDiscover(minutes: Int) {
    prefs().edit().putLong("discover_until", System.currentTimeMillis() + minutes * 60_000L)
      .putStringSet("discovered", emptySet()).apply()
  }

  @ReactMethod fun openNotificationAccess() {
    val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(i)
  }
}

class BankPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(BankModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

module.exports = function withBankCapture(config) {
  config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.RECEIVE_SMS']);
  config = withAndroidManifest(config, cfg => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.receiver = (app.receiver || []).filter(r => r.$['android:name'] !== `${PKG}.BankSmsReceiver`);
    app.receiver.push({
      $: { 'android:name': `${PKG}.BankSmsReceiver`, 'android:exported': 'true', 'android:permission': 'android.permission.BROADCAST_SMS' },
      'intent-filter': [{ $: { 'android:priority': '999' }, action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }] }],
    });
    app.service = (app.service || []).filter(s => s.$['android:name'] !== `${PKG}.BankNotificationListener`);
    app.service.push({
      $: {
        'android:name': `${PKG}.BankNotificationListener`,
        'android:label': 'ФИНИК · покупки из банка',
        'android:exported': 'true',
        'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }] }],
    });
    return cfg;
  });
  config = withKotlinFiles(config, PKG, {
    'BankQueue.kt': QUEUE, 'BankSmsReceiver.kt': SMS, 'BankNotificationListener.kt': LISTENER, 'BankModule.kt': MODULE,
  });
  return withReactPackage(config, `${PKG}.BankPackage`);
};
