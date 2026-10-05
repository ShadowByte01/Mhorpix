import { defineMusicEvent } from "../../structures/music/index.js";

export default defineMusicEvent({
	name: "nodeError",
	execute(_client, _nodeName, _error) {
		// TODO: alert text channels of affected players
	},
});
