export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/login") {
      return handleLogin(url, env);
    } else if (url.pathname === "/callback") {
      return handleCallback(request, env);
    } else {
      return new Response("Not Found", { status: 404 });
    }
  },
};

// ロールの安全性を確認する関数
function isSafeRole(roleId) {
  const forbiddenPermissions = [
    "ADMINISTRATOR",
    "MANAGE_SERVER",
    "MANAGE_ROLES",
    "BAN_MEMBERS",
    "KICK_MEMBERS",
  ];
  return !forbiddenPermissions.includes(roleId); // 簡易チェック（本来はAPIで検証するべき）
}

// ログインページ (Bootstrap 使用)
function handleLogin(url, env) {
  const role = url.searchParams.get("role");
  const guild = url.searchParams.get("guild");

  if (!role || !guild) {
    return new Response("Missing role or guild parameter", { status: 400 });
  }

  if (!isSafeRole(role)) {
    const unsafeHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Unsafe Role</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body class="bg-light text-center">
          <div class="container py-5">
            <h1 class="text-danger">Unsafe Role</h1>
            <p class="lead">The specified role has unsafe permissions and cannot be assigned.</p>
          </div>
        </body>
      </html>
    `;
    return new Response(unsafeHtml, { headers: { "Content-Type": "text/html" } });
  }

  const loginUrl = new URL("https://discord.com/api/oauth2/authorize");
  loginUrl.searchParams.append("client_id", env.DISCORD_CLIENT_ID);
  loginUrl.searchParams.append("redirect_uri", env.DISCORD_REDIRECT_URI);
  loginUrl.searchParams.append("response_type", "code");
  loginUrl.searchParams.append("scope", "identify guilds.join");
  loginUrl.searchParams.append("state", `${role}:${guild}`);

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light text-center">
        <div class="container py-5">
          <h1 class="mb-4">Login to Discord</h1>
          <a href="${loginUrl}" class="btn btn-primary btn-lg">Login with Discord</a>
        </div>
      </body>
    </html>
  `;
  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

// OAuth2認証後の処理
async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing code or state parameter", { status: 400 });
  }

  const [roleId, guildId] = state.split(":");
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: env.DISCORD_REDIRECT_URI,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!tokenResponse.ok) {
    const errorDetails = await tokenResponse.text();
    return new Response(`Failed to fetch access token: ${errorDetails}`, { status: tokenResponse.status });
  }

  const tokenData = await tokenResponse.json();
  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userResponse.ok) {
    return new Response("Failed to fetch user data", { status: userResponse.status });
  }

  const userData = await userResponse.json();

  // サーバーにユーザーが参加しているか確認
  const guildMemberResponse = await fetch(
    `https://discord.com/api/guilds/${guildId}/members/${userData.id}`,
    {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    }
  );

  if (guildMemberResponse.status === 404) {
    const notInGuildHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body class="bg-light text-center">
          <div class="container py-5">
            <h1 class="text-danger">Error</h1>
            <p class="lead">You are not a member of the specified server. Join the server before attempting to get a role.</p>
          </div>
        </body>
      </html>
    `;
    return new Response(notInGuildHtml, { headers: { "Content-Type": "text/html" } });
  }

  // ロールを付与
  const roleResponse = await fetch(
    `https://discord.com/api/guilds/${guildId}/members/${userData.id}/roles/${roleId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!roleResponse.ok) {
    const errorDetails = await roleResponse.text();
    return new Response(`Failed to assign role: ${errorDetails}`, { status: roleResponse.status });
  }

  // 成功メッセージ
  const successHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Success</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light text-center">
        <div class="container py-5">
          <h1 class="text-success">Success</h1>
          <p class="lead">Role assigned successfully!</p>
        </div>
      </body>
    </html>
  `;
  return new Response(successHtml, { headers: { "Content-Type": "text/html" } });
}