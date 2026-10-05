/**
 * Credits: Xentara — Made by Xentara, managed by Xentara HQ
 * Author:  @losttweeds.exe
 *
 */

import { defineMusicEvent } from "../../structures/music/index.js";
import { savePlayerSnapshot } from "../../structures/music/persistence.js";

export default defineMusicEvent({
	name: "playerUpdate",
	async execute(_client, player) {
		if (!player.hasCurrentTrack) return;
		await savePlayerSnapshot(player);
	},
});
