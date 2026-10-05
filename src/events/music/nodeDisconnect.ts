import { defineMusicEvent } from "../../structures/music/index.js";

export default defineMusicEvent({
	name: "nodeDisconnect",
	execute(_client, _nodeName, _movedPlayers) {
		// TODO: notify text channels of affected players
		// will do once i am done with basic structs and stuff
	},
});
