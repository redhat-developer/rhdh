import { Knex } from 'knex';

export type UserInfoRow = {
  user_entity_ref: string;
  user_info: string;
  updated_at: string;
};

export class DatabaseUserInfoStore {
  constructor(private readonly database: Knex) {}

  async getListUsers(): Promise<UserInfoRow[]> {
    return await this.database<UserInfoRow>('user_info');
  }

  async getQuantityRecordedActiveUsers(): Promise<number> {
    // Perform the count query with an alias for the count result
    const result = await this.database<UserInfoRow>('user_info')
      .count<{ count: number }>('user_entity_ref as count')
      .first();

    // Check if the result is valid and contains the count
    if (!result || result.count === undefined) {
      throw new Error('No user info found');
    }

    // Return the count as a number
    return result.count;
  }
}
