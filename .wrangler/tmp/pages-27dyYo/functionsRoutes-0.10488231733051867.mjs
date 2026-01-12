import { onRequestPost as __api_login_js_onRequestPost } from "C:\\Users\\SeanF\\Documents\\FantasyBoxOffice\\cf-auth-demo\\functions\\api\\login.js"
import { onRequestGet as __api_me_js_onRequestGet } from "C:\\Users\\SeanF\\Documents\\FantasyBoxOffice\\cf-auth-demo\\functions\\api\\me.js"
import { onRequestPost as __api_signup_js_onRequestPost } from "C:\\Users\\SeanF\\Documents\\FantasyBoxOffice\\cf-auth-demo\\functions\\api\\signup.js"
import { onRequest as __api_ping_js_onRequest } from "C:\\Users\\SeanF\\Documents\\FantasyBoxOffice\\cf-auth-demo\\functions\\api\\ping.js"

export const routes = [
    {
      routePath: "/api/login",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_login_js_onRequestPost],
    },
  {
      routePath: "/api/me",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_me_js_onRequestGet],
    },
  {
      routePath: "/api/signup",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_signup_js_onRequestPost],
    },
  {
      routePath: "/api/ping",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_ping_js_onRequest],
    },
  ]