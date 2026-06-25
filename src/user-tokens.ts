export interface FbCreds { pageId: string; accessToken: string; pageName: string }
export interface IgCreds { userId: string; accessToken: string }
export interface TtCreds { accessToken: string; refreshToken: string; openId: string; expiresAt: number; refreshExpiresAt: number }

export interface SocialTokens {
  facebook?: FbCreds;
  instagram?: IgCreds;
  tiktok?: TtCreds;
}

export async function getUserTokens(db: any, userId: number): Promise<SocialTokens> {
  const rows = await db.all("SELECT * FROM user_social_tokens WHERE user_id = ?", [userId]);
  const result: SocialTokens = {};
  for (const r of rows) {
    if (r.platform === "facebook" && r.page_id && r.access_token) {
      result.facebook = { pageId: r.page_id, accessToken: r.access_token, pageName: r.page_name || "" };
    } else if (r.platform === "instagram" && r.instagram_user_id && r.access_token) {
      result.instagram = { userId: r.instagram_user_id, accessToken: r.access_token };
    } else if (r.platform === "tiktok" && r.access_token) {
      result.tiktok = {
        accessToken: r.access_token,
        refreshToken: r.refresh_token || "",
        openId: r.open_id || "",
        expiresAt: r.expires_at || 0,
        refreshExpiresAt: r.refresh_expires_at || 0,
      };
    }
  }
  return result;
}

export async function saveUserToken(db: any, userId: number, platform: string, data: Record<string, any>) {
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO user_social_tokens
      (user_id, platform, access_token, refresh_token, page_id, page_name, open_id, instagram_user_id, instagram_username, expires_at, refresh_expires_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, platform) DO UPDATE SET
      access_token       = excluded.access_token,
      refresh_token      = excluded.refresh_token,
      page_id            = excluded.page_id,
      page_name          = excluded.page_name,
      open_id            = excluded.open_id,
      instagram_user_id  = excluded.instagram_user_id,
      instagram_username = excluded.instagram_username,
      expires_at         = excluded.expires_at,
      refresh_expires_at = excluded.refresh_expires_at,
      updated_at         = excluded.updated_at
  `, [
    userId, platform,
    data.access_token ?? null, data.refresh_token ?? null,
    data.page_id ?? null, data.page_name ?? null,
    data.open_id ?? null, data.instagram_user_id ?? null, data.instagram_username ?? null,
    data.expires_at ?? null, data.refresh_expires_at ?? null,
    now, now,
  ]);
}

export async function deleteUserToken(db: any, userId: number, platform: string) {
  await db.run("DELETE FROM user_social_tokens WHERE user_id = ? AND platform = ?", [userId, platform]);
}

export async function getUserSocialStatus(db: any, userId: number) {
  const tokens = await getUserTokens(db, userId);
  return {
    facebook: !!tokens.facebook,
    facebookPageName: tokens.facebook?.pageName || null,
    instagram: !!tokens.instagram,
    tiktok: !!tokens.tiktok && (tokens.tiktok.expiresAt > Date.now()),
  };
}
