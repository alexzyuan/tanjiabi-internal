export function createAuthRoutes(deps = {}) {
  const {
    config,
    sessionCookieName,
    oauthStateCookieName,
    sessionTtlMs,
    oauthStateTtlMs,
    frameLoginTicketTtlMs,
    oauthStates,
    frameLoginTickets,
    isPasswordLoginEnabled,
    validatePasswordLogin,
    createSession,
    serializeCookie,
    clearCookie,
    sendJson,
    readJsonBody,
    sendRedirect,
    sendFrameRedirect,
    isDingtalkLoginConfigured,
    buildCanonicalDingtalkLoginRedirect,
    buildDingtalkLoginUrl,
    randomToken,
    cleanupAuthStores,
    parseCookies,
    exchangeDingtalkCode,
    fetchDingtalkMe,
    resolveDingtalkLogin,
  } = deps;

  return [
    {
      method: "POST",
      path: "/api/auth/password/login",
      auth: "none",
      handler: async ({ req, res }) => {
        if (!isPasswordLoginEnabled()) {
          sendJson(res, 503, { ok: false, error: "管理员账号密码登录未配置，请使用钉钉扫码登录。" });
          return;
        }

        const payload = await readJsonBody(req);
        const username = String(payload.username || "").trim();
        const password = String(payload.password || "");
        const user = await validatePasswordLogin(config.auth, username, password);
        if (!user) {
          sendJson(res, 401, { ok: false, error: "管理员账号或密码不正确。" });
          return;
        }

        const sessionId = createSession({
          ...user,
          mobile: "",
          openId: "",
          unionId: "",
        });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": serializeCookie(sessionCookieName, sessionId, { maxAge: Math.floor(sessionTtlMs / 1000) }),
        });
        res.end(JSON.stringify({ ok: true, user }));
      },
    },
    {
      method: "GET",
      path: "/api/auth/dingtalk/login",
      auth: "none",
      handler: async ({ req, res, url }) => {
        if (!isDingtalkLoginConfigured(config.dingtalk.login)) {
          sendJson(res, 503, {
            ok: false,
            error: "钉钉登录未配置，请先设置 DINGTALK_CLIENT_ID、DINGTALK_CLIENT_SECRET、DINGTALK_REDIRECT_URI。",
          });
          return;
        }
        const canonicalRedirect = buildCanonicalDingtalkLoginRedirect(
          config.dingtalk.login,
          req.headers.host,
          `${url.pathname}${url.search}`,
        );
        if (canonicalRedirect) {
          sendRedirect(res, canonicalRedirect);
          return;
        }
        const state = randomToken();
        const frame = url.searchParams.get("frame") === "1";
        oauthStates.set(state, { expiresAt: Date.now() + oauthStateTtlMs, frame });
        sendRedirect(res, buildDingtalkLoginUrl(config.dingtalk.login, state), [
          serializeCookie(oauthStateCookieName, state, { maxAge: Math.floor(oauthStateTtlMs / 1000) }),
        ]);
      },
    },
    {
      method: "GET",
      path: "/api/auth/dingtalk/frame-complete",
      auth: "none",
      handler: async ({ res, url }) => {
        cleanupAuthStores();
        const ticket = String(url.searchParams.get("ticket") || "");
        const savedTicket = frameLoginTickets.get(ticket);
        if (!ticket || !savedTicket || savedTicket.expiresAt <= Date.now()) {
          if (ticket) frameLoginTickets.delete(ticket);
          sendRedirect(res, `/login?error=${encodeURIComponent("钉钉登录状态已失效，请重新扫码。")}`, [clearCookie(oauthStateCookieName)]);
          return;
        }

        frameLoginTickets.delete(ticket);
        sendRedirect(res, "/", [
          serializeCookie(sessionCookieName, savedTicket.sessionId, { maxAge: Math.floor(sessionTtlMs / 1000) }),
          clearCookie(oauthStateCookieName),
        ]);
      },
    },
    {
      method: "GET",
      path: "/api/auth/dingtalk/callback",
      auth: "none",
      handler: async ({ req, res, url }) => {
        let frameFlow = false;
        try {
          const code = url.searchParams.get("authCode") || url.searchParams.get("auth_code") || url.searchParams.get("code");
          const state = url.searchParams.get("state") || "";
          const cookies = parseCookies(req);
          const expectedState = cookies[oauthStateCookieName];
          const savedState = oauthStates.get(state);
          frameFlow = savedState?.frame === true;
          if (!code) throw new Error("钉钉没有返回授权码。");
          if (!state || !savedState || savedState.expiresAt <= Date.now() || (!frameFlow && (!expectedState || state !== expectedState))) {
            throw new Error("钉钉登录状态已失效，请重新扫码。");
          }

          oauthStates.delete(state);
          const token = await exchangeDingtalkCode(config.dingtalk.login, code);
          const user = await fetchDingtalkMe(token.accessToken);
          const decision = await resolveDingtalkLogin(user, config.auth);
          if (!decision.allowed) {
            if (frameFlow) {
              sendFrameRedirect(res, `/login?error=${encodeURIComponent(decision.reason || "当前钉钉账号尚未授权。")}`, [clearCookie(oauthStateCookieName)]);
              return;
            }
            sendRedirect(res, `/login?error=${encodeURIComponent(decision.reason || "当前钉钉账号尚未授权。")}`, [clearCookie(oauthStateCookieName)]);
            return;
          }

          const sessionId = createSession(decision.user);
          if (frameFlow) {
            const ticket = randomToken();
            frameLoginTickets.set(ticket, { sessionId, expiresAt: Date.now() + frameLoginTicketTtlMs });
            sendFrameRedirect(res, `/api/auth/dingtalk/frame-complete?ticket=${encodeURIComponent(ticket)}`, [clearCookie(oauthStateCookieName)]);
            return;
          }
          sendRedirect(res, "/", [
            serializeCookie(sessionCookieName, sessionId, { maxAge: Math.floor(sessionTtlMs / 1000) }),
            clearCookie(oauthStateCookieName),
          ]);
        } catch (error) {
          console.error("DingTalk login failed:", error);
          if (frameFlow) {
            sendFrameRedirect(res, `/login?error=${encodeURIComponent(error.message || "钉钉登录失败")}`, [clearCookie(oauthStateCookieName)]);
            return;
          }
          sendRedirect(res, `/login?error=${encodeURIComponent(error.message || "钉钉登录失败")}`, [clearCookie(oauthStateCookieName)]);
        }
      },
    },
    {
      method: "POST",
      path: "/api/auth/logout",
      auth: "session",
      handler: async ({ req, res }) => {
        const cookies = parseCookies(req);
        if (cookies[sessionCookieName]) deps.sessions.delete(cookies[sessionCookieName]);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": clearCookie(sessionCookieName),
        });
        res.end(JSON.stringify({ ok: true }));
      },
    },
  ];
}
