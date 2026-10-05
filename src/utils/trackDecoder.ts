type PluginFieldType = "TEXT" | "NULLABLE_TEXT" | "LONG" | "FLOAT" | "DOUBLE" | "BOOLEAN";

interface PluginField {
	readonly name: string;
	readonly type: PluginFieldType;
}

const PLUGIN_PRESETS: Record<string, readonly PluginField[]> = {
	lavasrc: [
		{ name: "albumName", type: "NULLABLE_TEXT" },
		{ name: "albumUrl", type: "NULLABLE_TEXT" },
		{ name: "artistUrl", type: "NULLABLE_TEXT" },
		{ name: "artistArtworkUrl", type: "NULLABLE_TEXT" },
		{ name: "previewUrl", type: "NULLABLE_TEXT" },
		{ name: "isPreview", type: "BOOLEAN" },
	],
};

export interface DecodedTrackInfo {
	readonly title: string;
	readonly author: string;
	readonly length: number;
	readonly identifier: string;
	readonly isStream: boolean;
	readonly isSeekable: boolean;
	readonly uri: string | null;
	readonly artworkUrl: string | null;
	readonly isrc: string | null;
	readonly sourceName: string;
}

export interface DecodedTrack {
	readonly info: DecodedTrackInfo;
	readonly pluginInfo: Record<string, unknown>;
}

class DataInputStream {
	private readonly view: DataView;
	public offset = 0;

	public constructor(buffer: ArrayBufferLike) {
		this.view = new DataView(buffer as ArrayBuffer);
	}

	public get byteLength(): number {
		return this.view.byteLength;
	}

	public readByte(): number {
		return this.view.getInt8(this.offset++);
	}

	public readInt(): number {
		const intValue = this.view.getInt32(this.offset);
		this.offset += 4;
		return intValue;
	}

	public readLong(): number {
		const high = this.view.getInt32(this.offset);
		const low = this.view.getUint32(this.offset + 4);
		this.offset += 8;
		return high * 0x100000000 + low;
	}

	public readFloat(): number {
		const floatValue = this.view.getFloat32(this.offset);
		this.offset += 4;
		return floatValue;
	}

	public readDouble(): number {
		const doubleValue = this.view.getFloat64(this.offset);
		this.offset += 8;
		return doubleValue;
	}

	public readBoolean(): boolean {
		return this.view.getUint8(this.offset++) !== 0;
	}

	public readUTF(): string {
		const len = this.view.getUint16(this.offset);
		this.offset += 2;
		const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
		this.offset += len;
		return new TextDecoder("utf-8").decode(bytes);
	}

	public readNullableText(): string | null {
		return this.readBoolean() ? this.readUTF() : null;
	}
}

function readField(stream: DataInputStream, type: PluginFieldType): unknown {
	switch (type) {
		case "TEXT":
			return stream.readUTF();
		case "NULLABLE_TEXT":
			return stream.readNullableText();
		case "LONG":
			return stream.readLong();
		case "FLOAT":
			return stream.readFloat();
		case "DOUBLE":
			return stream.readDouble();
		case "BOOLEAN":
			return stream.readBoolean();
	}
}

function decode(base64Track: string): DecodedTrack {
	const binary = atob(base64Track);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

	const stream = new DataInputStream(bytes.buffer);
	stream.readInt();
	const version = stream.readByte();

	const title = stream.readUTF();
	const author = stream.readUTF();
	const length = stream.readLong();
	const identifier = stream.readUTF();
	const isStream = stream.readBoolean();
	const isSeekable = true;
	const uri = stream.readNullableText();
	const artworkUrl = version >= 2 ? stream.readNullableText() : null;
	const isrc = version >= 3 ? stream.readNullableText() : null;
	const sourceName = stream.readUTF();

	let pluginInfo: Record<string, unknown> = {};

	if (stream.offset < stream.byteLength - 8) {
		for (const [, fields] of Object.entries(PLUGIN_PRESETS)) {
			const checkpoint = stream.offset;
			try {
				const temp: Record<string, unknown> = {};
				for (const field of fields) {
					temp[field.name] = readField(stream, field.type);
				}
				pluginInfo = temp;
				break;
			} catch {
				stream.offset = checkpoint;
			}
		}
	}

	return {
		info: {
			title,
			author,
			length,
			identifier,
			isStream,
			isSeekable,
			uri,
			artworkUrl,
			isrc,
			sourceName,
		},
		pluginInfo,
	};
}

function formatDuration(ms: number): string {
	if (!ms || ms < 0) return "Live";
	const seconds = Math.floor((ms / 1000) % 60);
	const minutes = Math.floor((ms / (1000 * 60)) % 60);
	const hours = Math.floor(ms / (1000 * 60 * 60));
	if (hours > 0)
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export const TrackDecoder = { decode, formatDuration };
