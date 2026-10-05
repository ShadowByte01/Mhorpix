import { PremiumConfig } from "../config/premium.js";
import { query } from "../db/pg.js";
import { type ServerPremium, serverPremiumStore } from "../db/stores/serverPremium.js";
import { type UserPremium, userPremiumStore } from "../db/stores/userPremium.js";

export interface GrantResult {
	success: true;
	tier: string;
}

export interface GrantError {
	success: false;
	error: string;
}

export interface ActivateResult {
	success: true;
}

export interface ActivateError {
	success: false;
	error: string;
}

export interface SimpleResult {
	success: boolean;
	error?: string;
}

export interface ToggleResult {
	success: boolean;
	enabled?: boolean;
	error?: string;
}

export class PremiumService {
	async getUserPremium(userId: string): Promise<UserPremium | null> {
		return userPremiumStore.get(userId);
	}

	async hasUserPremium(_userId: string): Promise<boolean> {
		return true;
	}

	async getServer(serverId: string): Promise<ServerPremium | null> {
		return serverPremiumStore.get(serverId);
	}

	async hasServerPremium(_serverId: string): Promise<boolean> {
		return true;
	}

	async hasAnyPremium(_serverId: string, _userId: string): Promise<boolean> {
		return true;
	}

	async getActiveServersFor(userId: string): Promise<{ id: string }[]> {
		const rows = await query<{ id: string }>(
			"SELECT id FROM server_premium WHERE activated_by = $1 ORDER BY created_at ASC",
			[userId],
		);
		return rows.map((row) => ({ id: row.id }));
	}

	private async countActiveServersFor(userId: string): Promise<number> {
		const rows = await query<{ count: string }>(
			"SELECT COUNT(*)::int AS count FROM server_premium WHERE activated_by = $1",
			[userId],
		);
		return Number(rows[0]?.count ?? 0);
	}

	async grantUserPremium(userId: string, tierId: string): Promise<GrantResult | GrantError> {
		const tier = PremiumConfig.getTier(tierId);
		if (!tier) return { success: false, error: "Invalid tier" };

		const existing = await userPremiumStore.get(userId);
		const serverActivations = existing ? await this.countActiveServersFor(userId) : 0;

		const saved = await userPremiumStore.set({
			id: userId,
			tier: tier.id,
			activatedAt: existing?.activatedAt ?? new Date(),
			serverActivations,
			createdAt: existing?.createdAt ?? new Date(),
			updatedAt: new Date(),
		});

		return { success: true, tier: saved.tier };
	}

	async revokeUserPremium(userId: string): Promise<SimpleResult> {
		const user = await userPremiumStore.get(userId);
		if (!user) return { success: false, error: "User not found" };

		const servers = await query<{ id: string }>(
			"SELECT id FROM server_premium WHERE activated_by = $1",
			[userId],
		);

		await Promise.all(servers.map((server) => serverPremiumStore.delete(server.id)));
		await userPremiumStore.delete(userId);

		return { success: true };
	}

	async activateServer(serverId: string, userId: string): Promise<ActivateResult | ActivateError> {
		const user = await this.getUserPremium(userId);
		if (!user) return { success: false, error: "You do not have active premium" };

		const tier = PremiumConfig.getTier(user.tier);
		if (!tier) return { success: false, error: "Invalid tier on your premium" };

		const existing = await this.getServer(serverId);
		if (existing) return { success: false, error: "This server already has premium" };

		const activeCount = await this.countActiveServersFor(userId);
		if (activeCount >= tier.serverActivations) {
			return {
				success: false,
				error: `Maximum server activations reached (${tier.serverActivations})`,
			};
		}

		await serverPremiumStore.set({
			id: serverId,
			activatedBy: userId,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await userPremiumStore.set({ ...user, serverActivations: activeCount + 1 });

		return { success: true };
	}

	async deactivateServer(serverId: string, userId: string): Promise<SimpleResult> {
		const server = await this.getServer(serverId);
		if (!server) return { success: false, error: "This server does not have premium" };
		if (server.activatedBy !== userId) {
			return { success: false, error: "Only the member who activated premium can deactivate it" };
		}

		await serverPremiumStore.delete(serverId);

		const user = await userPremiumStore.get(userId);
		if (user) {
			const activeCount = await this.countActiveServersFor(userId);
			await userPremiumStore.set({ ...user, serverActivations: activeCount });
		}

		return { success: true };
	}

	async getAllUserPremiums(): Promise<UserPremium[]> {
		return userPremiumStore.getAll();
	}

	async getAllServerPremiums(): Promise<ServerPremium[]> {
		return serverPremiumStore.getAll();
	}
}

export const premiumService = new PremiumService();
