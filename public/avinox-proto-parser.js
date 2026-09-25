/* ==========================================================================
   Avinox .proto ride record parser (client-side).
   Format: 251-byte header (magic 0xA5A5A5A5) followed by 0x02EB frames
   carrying protobuf-encoded samples. Field numbers come from the community
   reverse-engineering effort (documented by the Avinox Ride Explorer
   project via comparison with Strava FIT exports) — factual data, not
   official DJI documentation. This is an independent implementation.
   Nothing is uploaded: parsing happens entirely in the browser.
   ========================================================================== */
(function (global) {
    "use strict";

    var HEADER_SIZE = 251, MAGIC = 0xa5a5a5a5, FRAME_TYPE = 0x02eb;

    function varint(bytes, pos) {
        var value = 0n, shift = 0n, b;
        do {
            if (pos >= bytes.length) throw Error("Invalid varint");
            b = bytes[pos++];
            value |= BigInt(b & 127) << shift;
            shift += 7n;
        } while (b & 128);
        return [value, pos];
    }

    function num(v) { return v == null ? null : Number(v); }

    function signed(v) {
        if (v == null) return null;
        return v >= (1n << 63n) ? Number(v - (1n << 64n)) : Number(v);
    }

    function f32(v) {
        if (v == null) return null;
        var b = new ArrayBuffer(4), d = new DataView(b);
        d.setUint32(0, Number(v), true);
        return d.getFloat32(0, true);
    }

    function f64(v) {
        if (v == null) return null;
        var b = new ArrayBuffer(8), d = new DataView(b);
        /* GPS doubles arrive as huge integers (varint or fixed64 bit
           patterns) far above 2^53: keep them as BigInt end-to-end. */
        var big = typeof v === 'bigint' ? v : BigInt(Math.round(v));
        d.setBigUint64(0, big, true);
        return d.getFloat64(0, true);
    }

    /* Decode one protobuf message into a {fieldNumber: value} map. */
    function message(bytes) {
        var p = 0, out = {};
        while (p < bytes.length) {
            var t = varint(bytes, p), tag = Number(t[0]);
            p = t[1];
            var field = tag >> 3, wire = tag & 7, v;
            if (wire === 0) { t = varint(bytes, p); v = t[0]; p = t[1]; }
            else if (wire === 1) { v = new DataView(bytes.buffer, bytes.byteOffset + p, 8).getBigUint64(0, true); p += 8; }
            else if (wire === 5) { v = BigInt(new DataView(bytes.buffer, bytes.byteOffset + p, 4).getUint32(0, true)); p += 4; }
            else if (wire === 2) { t = varint(bytes, p); var n = Number(t[0]); p = t[1]; v = bytes.slice(p, p + n); p += n; }
            else throw Error("Unsupported protobuf wire type " + wire);
            out[field] = v;
        }
        return out;
    }

    /* Map a decoded sample message to named channels (scaled). */
    function sample(f) {
        var ts = num(f[72]), temp = signed(f[41]);
        return {
            timestamp: ts,
            date: ts ? new Date(ts * 1000) : null,
            speed: num(f[7]) / 100 || 0,
            assist: num(f[8]),
            cadence: num(f[9]) / 100 || 0,
            motorTorque: num(f[10]) / 100 || 0,
            riderTorque: num(f[11]) / 100 || 0,
            totalTorque: num(f[12]) / 100 || 0,
            riderPower: num(f[13]) / 100 || 0,
            motorPower: num(f[14]) / 100 || 0,
            totalPower: num(f[15]) / 100 || 0,
            gear: num(f[22]),
            imuX: f32(f[36]),
            imuY: f32(f[37]),
            imuZ: f32(f[38]),
            distanceKm: (num(f[23]) || 0) / 1000,
            latitude: f64(f[31]),
            longitude: f64(f[32]),
            altitude: num(f[39]) / 100 || 0,
            gradient: f[40] == null ? null : signed(f[40]) / 100,
            temperature: temp === -99900 ? null : temp / 100,
            pressure: num(f[42]) / 100 || null,
            heartRate: num(f[51]),
            riderEnergyKj: (num(f[52]) || 0) / 1000,
            battery: num(f[71]),
            odometerKm: (num(f[73]) || 0) / 1000,
            event: num(f[75])
        };
    }

    function parse(buffer, name) {
        var bytes = new Uint8Array(buffer), v = new DataView(buffer);
        if (bytes.length < HEADER_SIZE || v.getUint32(0, true) !== MAGIC) {
            throw Error("This is not an Avinox cloud ride record.");
        }
        var start = v.getUint32(10, true), end = v.getUint32(14, true);
        var rawSerial = bytes.slice(110, 128), serial = "";
        for (var q = 0; q < rawSerial.length && rawSerial[q]; q++) serial += String.fromCharCode(rawSerial[q]);

        var meta = {
            fileName: name || "Avinox ride",
            rideId: v.getUint32(6, true),
            start: start,
            end: end,
            duration: end - start,
            ascent: v.getFloat32(22, true),
            descent: v.getFloat32(26, true),
            serial: serial
        };

        /* Frame walk: do not trust the header sample count — end of file is
           the reliable boundary (some files carry one extra final frame). */
        var samples = [], p = HEADER_SIZE;
        while (p < bytes.length) {
            if (p + 6 > bytes.length) throw Error("Truncated Avinox frame");
            var type = v.getUint16(p, true), len = v.getUint16(p + 2, true);
            if (type !== FRAME_TYPE) throw Error("Unknown frame type at byte " + p);
            samples.push(sample(message(bytes.slice(p + 4, p + 4 + len))));
            p += len + 6;
        }
        meta.samples = samples.length;
        return { metadata: meta, samples: samples };
    }

    global.AvinoxProtoParser = { parse: parse };
})(window);
