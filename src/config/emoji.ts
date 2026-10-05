const emojiDictionary = {
	artist: "<:artist:1556270559548014712>",
	duration_grey: "<:duration_grey:1556270578158145647>",
	more: "<:more:1556270598047539291>",
	play: "<:play:1556270604754362378>",
	drag_up: "<:drag_up:1556270575989825677>",
	drag_down: "<:drag_down:1556270573733159034>",
	remove: "<:remove:1556270607916859482>",
	left: "<:left:1556270592892862514>",
	right: "<:right:1556270614757515264>",
	requester: "<:requester:1556270610387181568>",
	blank: "<:blank:1556270563561967776>",
	info: "<:info:1556270587767427112>",
	check: "<:check:1556270566225485824>",
	cross: "<:cross:1556270570583236678>",
	track: "<:track:1556270621875507241>",
	pause: "<:pause:1556270602342371388>",
	resume: "<:resume:1556270612517748766>",
	stop: "<:stop:1556270619442815006>",
	skip: "<:skip:1556270617265967174>",
	utility: "<:utility:1556270624664457347>",
	music: "<:music:1556270600140357686>",
	loading: "<:loading:1556270595279429682>",
	information: "<:information:1556270590355177472>",
	home: "<:home:1556270585452044319>",
	favourite: "<:favourite:1556270582524551269>",
	config: "<:config:1556270568314110082>",
} as const;

/** * Extracted type of valid emoji names based on the dictionary keys.
 */
export type EmojiName = keyof typeof emojiDictionary;

/**
 * The emoji utility object.
 */
export const emoji = {
	/**
	 * Retrieves a  emoji by its name.
	 * * @param name - The key of the emoji defined in `emojiDictionary`.
	 * @returns The Discord formatted emoji string. Returns a fallback "❓" if somehow bypassed.
	 */
	get(name: EmojiName): string {
		return emojiDictionary[name] ?? "❓";
	},
	/**
	 * Retrieves the snowflake ID of a emoji by its name.
	 */
	getId(name: EmojiName): string | null {
		const str = emojiDictionary[name];
		if (!str) return null;
		const match = str.match(/<:\w+:(\d+)>/);
		return match ? (match[1] as string) : null;
	},
};
