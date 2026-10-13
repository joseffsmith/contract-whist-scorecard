package uk.joseffsmith.whist;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.Build;
import android.os.ParcelUuid;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * "Join this table": while the host shows the invite, the phone advertises
 * the Whist table service over Bluetooth LE and serves one readable
 * characteristic, a small JSON {"g": gameId, "n": host's name}. Phones
 * nearby find it with @capacitor-community/bluetooth-le (src/lib/nearby.ts).
 * The iOS side is ios/App/App/TableNearbyPlugin.swift.
 */
@CapacitorPlugin(
    name = "TableNearby",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = { Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT }
        )
    }
)
public class TableNearbyPlugin extends Plugin {

    // Keep in step with src/lib/nearby.ts and the iOS plugin.
    static final UUID SERVICE = UUID.fromString("e62c7db0-f38e-4db6-8651-aa677b9ea2c8");
    static final UUID TABLE = UUID.fromString("3ccf0d62-8326-4755-9836-e4f29387516d");

    private BluetoothGattServer server;
    private BluetoothLeAdvertiser advertiser;
    private byte[] payload;
    // The callback advertising was started with: stopping needs the same one.
    private AdvertiseCallback advertising;

    @PluginMethod
    public void startHosting(PluginCall call) {
        String gameId = call.getString("gameId");
        if (gameId == null) {
            call.reject("Missing gameId.", "bad_options");
            return;
        }
        String name = call.getString("name", "");
        if (name.length() > 40) name = name.substring(0, 40);
        try {
            payload = new JSONObject().put("g", gameId).put("n", name).toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException e) {
            call.reject("Bad options.", "bad_options");
            return;
        }
        // Android 12+ asks for "Nearby devices" first.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "afterPermission");
            return;
        }
        host(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) {
            host(call);
        } else {
            call.reject("Bluetooth isn't allowed for Whist.", "unauthorized");
        }
    }

    @PluginMethod
    public void stopHosting(PluginCall call) {
        stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stop();
    }

    @SuppressLint("MissingPermission") // checked in startHosting
    private void host(PluginCall call) {
        stop();
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            call.reject("This phone can't do Bluetooth LE.", "unsupported");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is off.", "off");
            return;
        }
        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            call.reject("This phone can't advertise over Bluetooth LE.", "unsupported");
            return;
        }
        server = manager.openGattServer(
            getContext(),
            new BluetoothGattServerCallback() {
                @Override
                public void onCharacteristicReadRequest(
                    BluetoothDevice device,
                    int requestId,
                    int offset,
                    BluetoothGattCharacteristic characteristic
                ) {
                    BluetoothGattServer gatt = server;
                    byte[] value = payload;
                    if (gatt == null) return;
                    if (value == null || !TABLE.equals(characteristic.getUuid())) {
                        gatt.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null);
                    } else if (offset > value.length) {
                        gatt.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null);
                    } else {
                        gatt.sendResponse(
                            device,
                            requestId,
                            BluetoothGatt.GATT_SUCCESS,
                            offset,
                            Arrays.copyOfRange(value, offset, value.length)
                        );
                    }
                }
            }
        );
        if (server == null) {
            call.reject("Couldn't start Bluetooth.", "failed");
            return;
        }
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(
            new BluetoothGattCharacteristic(
                TABLE,
                BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            )
        );
        server.addService(service);

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .setTimeout(0)
            .build();
        AdvertiseData data = new AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(new ParcelUuid(SERVICE))
            .build();
        advertising = new AdvertiseCallback() {
                @Override
                public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                    call.resolve();
                }

                @Override
                public void onStartFailure(int errorCode) {
                    stop();
                    call.reject("Couldn't advertise over Bluetooth (" + errorCode + ").", "failed");
                }
            };
        advertiser.startAdvertising(settings, data, advertising);
    }

    @SuppressLint("MissingPermission")
    private void stop() {
        payload = null;
        try {
            if (advertiser != null && advertising != null) advertiser.stopAdvertising(advertising);
        } catch (SecurityException | IllegalStateException ignored) {}
        advertiser = null;
        advertising = null;
        try {
            if (server != null) server.close();
        } catch (SecurityException ignored) {}
        server = null;
    }
}
