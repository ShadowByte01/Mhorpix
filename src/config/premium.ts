export interface PremiumTierConfig {
	id: string;
	name: string;
	price: number;
	durationDays: number;
	serverActivations: number;
}

const tiers = {
	LITE: {
		id: "lite",
		name: "Lite",
		price: 1,
		serverActivations: 0,
		durationDays: 30,
	},
	BASIC: {
		id: "basic",
		name: "Standard",
		price: 2,
		serverActivations: 1,
		durationDays: 30,
	},
	PREMIUM: {
		id: "premium",
		name: "Ultra",
		price: 2.5,
		serverActivations: 2,
		durationDays: 30,
	},
	OWNER: {
		id: "owner",
		name: "Owner",
		price: 0,
		serverActivations: 9999999,
		durationDays: 1000,
	},
} as const satisfies Record<string, PremiumTierConfig>;

export type PremiumTierId = (typeof tiers)[keyof typeof tiers]["id"];

export const PremiumConfig = {
	tiers,

	getTier(tierId: string): PremiumTierConfig | null {
		return Object.values(tiers).find((t) => t.id === tierId) ?? null;
	},

	getAllTiers(): PremiumTierConfig[] {
		return Object.values(tiers);
	},

	isValidTier(tierId: string): tierId is PremiumTierId {
		return Object.values(tiers).some((t) => t.id === tierId);
	},
};
