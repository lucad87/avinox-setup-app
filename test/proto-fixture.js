/* Builds Avinox .proto recordings for the tests: a 251-byte header followed
   by 0x02EB frames, each carrying one protobuf-encoded sample. */

function varint(n) {
    let v = BigInt.asUintN(64, BigInt(Math.round(n)));
    const out = [];
    do {
        let b = Number(v & 127n);
        v >>= 7n;
        if (v) b |= 128;
        out.push(b);
    } while (v);
    return out;
}

const key = (field, wire) => varint((field << 3) | wire);
const varintField = (field, n) => [...key(field, 0), ...varint(n)];
const doubleField = (field, x) => {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(x);
    return [...key(field, 1), ...b];
};

/** Protobuf fields of one sample; a key left undefined is not written. */
function sampleFields(s) {
    const f = [];
    const put = (field, value, scale = 1) => {
        if (value !== undefined) f.push(...varintField(field, value * scale));
    };
    put(72, s.timestamp);
    put(7, s.speed, 100);
    put(8, s.assist);
    put(9, s.cadence, 100);
    put(13, s.riderPower, 100);
    put(14, s.motorPower, 100);
    put(23, s.distanceKm, 1000);
    if (s.latitude !== undefined) f.push(...doubleField(31, s.latitude));
    if (s.longitude !== undefined) f.push(...doubleField(32, s.longitude));
    put(39, s.altitude, 100);
    put(41, s.temperature, 100);
    put(71, s.battery);
    return f;
}

function buildProto(samples, { rideId = 1, ascent = 0, descent = 0 } = {}) {
    const frames = samples.map((s) => {
        const msg = Buffer.from(sampleFields(s));
        const head = Buffer.alloc(4);
        head.writeUInt16LE(0x02eb, 0);
        head.writeUInt16LE(msg.length, 2);
        return Buffer.concat([head, msg, Buffer.alloc(2)]);
    });
    const start = samples.length ? samples[0].timestamp : 0;
    const end = samples.length ? samples[samples.length - 1].timestamp : 0;
    const header = Buffer.alloc(251);
    header.writeUInt32LE(0xa5a5a5a5, 0);
    header.writeUInt32LE(rideId, 6);
    header.writeUInt32LE(start, 10);
    header.writeUInt32LE(end, 14);
    header.writeFloatLE(ascent, 22);
    header.writeFloatLE(descent, 26);
    const file = Buffer.concat([header, ...frames]);
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.length);
}

module.exports = { buildProto };
