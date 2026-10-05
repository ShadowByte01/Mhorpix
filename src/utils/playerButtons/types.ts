export const PLAYER_BUTTON_PREFIX = "player";
export const PLAYER_SETTINGS_MODAL_ID = "playerSettingsModal";

export const SETTINGS_VOLUME_FIELD = "settingsVolume";
export const SETTINGS_LOOP_FIELD = "settingsLoop";
export const SETTINGS_FAVOURITE_FIELD = "settingsFavourite";
export const SETTINGS_PLAYLIST_FIELD = "settingsPlaylist";
export const SETTINGS_FAIRPLAY_FIELD = "settingsFairplay";
export const SETTINGS_AUTOPLAY_FIELD = "settingsAutoplay";

export type PlayerButtonAction = "playpause" | "skip" | "stop" | "settings";

const ACTIONS: readonly PlayerButtonAction[] = ["playpause", "skip", "stop", "settings"];

export function playerButtonId(action: PlayerButtonAction): string {
	return `${PLAYER_BUTTON_PREFIX}:${action}`;
}

export function parsePlayerButtonId(customId: string): PlayerButtonAction | null {
	const [prefix, action] = customId.split(":");
	if (prefix !== PLAYER_BUTTON_PREFIX) return null;
	return ACTIONS.includes(action as PlayerButtonAction) ? (action as PlayerButtonAction) : null;
}

export function isPlayerSettingsModalId(customId: string): boolean {
	return customId === PLAYER_SETTINGS_MODAL_ID;
}
