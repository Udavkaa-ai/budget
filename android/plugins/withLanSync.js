// Обмен данными между телефонами семьи напрямую по домашнему Wi-Fi, без
// облака и сервера. Подключается в личной сборке (см. app.config.js).
//
// Пока ФИНИК открыт, телефон поднимает маленький HTTP-сервер на случайном
// порту и объявляет его в сети (Android NSD, тип _finik._tcp). Найденные
// соседи и входящие запросы уходят в JS (src/local/lan.ts) — там данные,
// проверка кода пары и ответ. Исходящие запросы — через обычный сокет
// (политика cleartext-HTTP на них не распространяется).
const { AndroidConfig } = require('@expo/config-plugins');
const { withReactPackage, withKotlinFiles } = require('./_shared');

const PKG = 'com.familybudget.lan';

const MODULE = `package ${PKG}

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class LanModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "FinikLan"

  private class Slot { val latch = CountDownLatch(1); var status = 503; var body = "{}" }

  private var server: ServerSocket? = null
  private var nsd: NsdManager? = null
  private var reg: NsdManager.RegistrationListener? = null
  private var disc: NsdManager.DiscoveryListener? = null
  private var selfName = ""
  private val pending = ConcurrentHashMap<String, Slot>()
  private val pool = Executors.newCachedThreadPool()
  private val main = Handler(Looper.getMainLooper())

  private fun emit(name: String, map: WritableMap) {
    try { ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, map) } catch (e: Exception) { }
  }

  @ReactMethod fun addListener(eventName: String) { }
  @ReactMethod fun removeListeners(count: Int) { }

  @ReactMethod fun start(name: String, promise: Promise) {
    try {
      stopInternal()
      selfName = name
      val ss = ServerSocket(0)
      server = ss
      pool.execute { acceptLoop(ss) }
      val m = ctx.getSystemService(Context.NSD_SERVICE) as NsdManager
      nsd = m
      val info = NsdServiceInfo()
      info.serviceName = name
      info.serviceType = "_finik._tcp."
      info.port = ss.localPort
      val r = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(si: NsdServiceInfo) { selfName = si.serviceName }
        override fun onRegistrationFailed(si: NsdServiceInfo, code: Int) { }
        override fun onServiceUnregistered(si: NsdServiceInfo) { }
        override fun onUnregistrationFailed(si: NsdServiceInfo, code: Int) { }
      }
      reg = r
      m.registerService(info, NsdManager.PROTOCOL_DNS_SD, r)
      val d = object : NsdManager.DiscoveryListener {
        override fun onStartDiscoveryFailed(t: String, code: Int) { }
        override fun onStopDiscoveryFailed(t: String, code: Int) { }
        override fun onDiscoveryStarted(t: String) { }
        override fun onDiscoveryStopped(t: String) { }
        override fun onServiceFound(si: NsdServiceInfo) {
          if (si.serviceName != selfName && si.serviceType.contains("_finik")) resolve(si, 0)
        }
        override fun onServiceLost(si: NsdServiceInfo) {
          val m2 = Arguments.createMap(); m2.putString("name", si.serviceName); emit("FinikLanLost", m2)
        }
      }
      disc = d
      m.discoverServices("_finik._tcp.", NsdManager.PROTOCOL_DNS_SD, d)
      promise.resolve(ss.localPort)
    } catch (e: Exception) { promise.reject("lan", e.message ?: "lan") }
  }

  // Разрешение адреса; старые Android не дают резолвить параллельно — повторяем
  private fun resolve(si: NsdServiceInfo, attempt: Int) {
    val m = nsd ?: return
    try {
      m.resolveService(si, object : NsdManager.ResolveListener {
        override fun onResolveFailed(s: NsdServiceInfo, code: Int) {
          if (attempt < 4) main.postDelayed({ resolve(si, attempt + 1) }, 1200L * (attempt + 1))
        }
        override fun onServiceResolved(s: NsdServiceInfo) {
          val host = s.host?.hostAddress ?: return
          val map = Arguments.createMap()
          map.putString("name", s.serviceName)
          map.putString("host", host)
          map.putInt("port", s.port)
          emit("FinikLanPeer", map)
        }
      })
    } catch (e: Exception) { }
  }

  @ReactMethod fun stop() { stopInternal() }

  private fun stopInternal() {
    try { server?.close() } catch (e: Exception) { }
    server = null
    val m = nsd
    try { reg?.let { m?.unregisterService(it) } } catch (e: Exception) { }
    try { disc?.let { m?.stopServiceDiscovery(it) } } catch (e: Exception) { }
    reg = null; disc = null
  }

  private fun acceptLoop(ss: ServerSocket) {
    while (!ss.isClosed) {
      val s = try { ss.accept() } catch (e: Exception) { break }
      pool.execute { handle(s) }
    }
  }

  private fun readLine(inp: InputStream): String {
    val b = ByteArrayOutputStream()
    while (true) {
      val c = inp.read()
      if (c < 0 || c == '\\n'.code) break
      if (c != '\\r'.code) b.write(c)
    }
    return b.toString("UTF-8")
  }

  private fun readHttp(inp: InputStream): Triple<String, Map<String, String>, String> {
    val first = readLine(inp)
    val headers = HashMap<String, String>()
    while (true) {
      val l = readLine(inp)
      if (l.isEmpty()) break
      val i = l.indexOf(':')
      if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
    }
    val len = headers["content-length"]?.toIntOrNull() ?: 0
    val body = ByteArray(len)
    var off = 0
    while (off < len) { val n = inp.read(body, off, len - off); if (n < 0) break; off += n }
    return Triple(first, headers, String(body, 0, off, Charsets.UTF_8))
  }

  private fun handle(s: Socket) {
    try {
      s.soTimeout = 20000
      val inp = BufferedInputStream(s.getInputStream())
      val (first, headers, body) = readHttp(inp)
      val parts = first.split(" ")
      val id = UUID.randomUUID().toString()
      val slot = Slot()
      pending[id] = slot
      val map = Arguments.createMap()
      map.putString("id", id)
      map.putString("method", parts.getOrElse(0) { "GET" })
      map.putString("path", parts.getOrElse(1) { "/" })
      map.putString("key", headers["x-finik-key"] ?: "")
      map.putString("body", body)
      emit("FinikLanRequest", map)
      slot.latch.await(25, TimeUnit.SECONDS)
      pending.remove(id)
      val out = slot.body.toByteArray(Charsets.UTF_8)
      val head = "HTTP/1.1 " + slot.status + " OK\\r\\nContent-Type: application/json; charset=utf-8\\r\\nContent-Length: " + out.size + "\\r\\nConnection: close\\r\\n\\r\\n"
      val os = s.getOutputStream()
      os.write(head.toByteArray(Charsets.UTF_8)); os.write(out); os.flush()
    } catch (e: Exception) { } finally { try { s.close() } catch (e: Exception) { } }
  }

  // Ответ из JS на входящий запрос
  @ReactMethod fun respond(id: String, status: Int, body: String) {
    val slot = pending[id] ?: return
    slot.status = status; slot.body = body
    slot.latch.countDown()
  }

  // Исходящий запрос к соседу: возвращает { status, body }
  @ReactMethod fun request(host: String, port: Int, method: String, path: String, key: String, body: String, promise: Promise) {
    pool.execute {
      try {
        Socket().use { s ->
          s.connect(InetSocketAddress(host, port), 5000)
          s.soTimeout = 30000
          val data = body.toByteArray(Charsets.UTF_8)
          val head = method + " " + path + " HTTP/1.1\\r\\nHost: finik\\r\\nX-Finik-Key: " + key +
            "\\r\\nContent-Type: application/json\\r\\nContent-Length: " + data.size + "\\r\\nConnection: close\\r\\n\\r\\n"
          val os = s.getOutputStream()
          os.write(head.toByteArray(Charsets.UTF_8)); os.write(data); os.flush()
          val (first, _, resp) = readHttp(BufferedInputStream(s.getInputStream()))
          val code = first.split(" ").getOrElse(1) { "0" }.toIntOrNull() ?: 0
          val map = Arguments.createMap()
          map.putInt("status", code)
          map.putString("body", resp)
          promise.resolve(map)
        }
      } catch (e: Exception) { promise.reject("lan", e.message ?: "lan") }
    }
  }
}

class LanPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(LanModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

module.exports = function withLanSync(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.CHANGE_WIFI_MULTICAST_STATE',
  ]);
  config = withKotlinFiles(config, PKG, { 'LanModule.kt': MODULE });
  return withReactPackage(config, `${PKG}.LanPackage`);
};
