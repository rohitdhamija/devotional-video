#!/usr/bin/env python3
"""Prints a JPEG's EXIF orientation (1-8), or 1 if it has none. Standard library only."""
import struct
import sys

data = open(sys.argv[1], "rb").read(262144)
start = data.find(b"Exif\x00\x00")
value = 1
if start >= 0:
    tiff = data[start + 6:]
    order = "<" if tiff[:2] == b"II" else ">"
    try:
        ifd = struct.unpack(order + "I", tiff[4:8])[0]
        for k in range(struct.unpack(order + "H", tiff[ifd:ifd + 2])[0]):
            entry = tiff[ifd + 2 + 12 * k: ifd + 14 + 12 * k]
            if struct.unpack(order + "H", entry[:2])[0] == 0x0112:
                value = struct.unpack(order + "H", entry[8:10])[0]
    except struct.error:
        pass
print(value)
