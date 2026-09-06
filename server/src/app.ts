import Fastify from "fastify";
import websocket from "@fastify/websocket";
import statik from "@fastify/static";
import { join } from "node:path";
import { loadConfig, type Config } from "./config.js";
import { openDatabase } from "./db.js";
import { ServiceError, TriviaService } from "./service.js";

const bearer=(value:string|undefined)=>value?.startsWith("Bearer ")?value.slice(7):undefined;
const serverCredential=(request:any)=>request.headers["x-server-access-password"];
export function createApp(options:Partial<Config> = {}) {
  const config=loadConfig(options), db=openDatabase(config.databasePath), service=new TriviaService(db,config);
  const app=Fastify({bodyLimit: 1_048_576, logger:{redact:["req.headers.authorization","req.headers.x-server-access-password","req.body.password","req.body.refreshToken","req.body.reconnectToken"]}});
  app.register(websocket);
  app.decorate("trivia",service);
  app.addHook("onClose",()=>{service.shutdown();db.close();});
  app.setErrorHandler((error,_request,reply)=>{if(error instanceof ServiceError)return reply.code(error.status).send({error:{code:error.code,message:error.message}}); app.log.error(error);return reply.code(500).send({error:{code:"internal_error",message:"An unexpected error occurred."}});});
  app.get("/health",async()=>({status:"ok",service:"mairs-trivia",apiVersion:"v1",timestamp:new Date().toISOString()}));
  app.post("/v1/access/validate",async(request,reply)=>reply.send({valid:service.verifyServerAccess(serverCredential(request))}));
  const requireServer=(r:any)=>{if(!service.verifyServerAccess(serverCredential(r)))throw new ServiceError(401,"invalid_server_access","Server access credential is invalid.");};
  app.post("/v1/auth/register",async(r:any)=>{requireServer(r);return service.register(r.body.username,r.body.password);});
  app.post("/v1/auth/login",async(r:any)=>{requireServer(r);return service.login(r.body.username,r.body.password);});
  app.post("/v1/auth/refresh",async(r:any)=>service.refresh(r.body.refreshToken));
  app.post("/v1/auth/logout",async(r:any)=>{service.logout(bearer(r.headers.authorization)??"");return {ok:true};});
  const host=(r:any)=>service.authenticate(bearer(r.headers.authorization));
  app.get("/v1/me",async(r:any)=>service.me(host(r)));
  app.get("/v1/games",async(r:any)=>service.listGames(host(r)));
  app.post("/v1/games",async(r:any)=>service.createGame(host(r),r.body));
  app.get("/v1/games/:gameId",async(r:any)=>service.hostState(host(r),r.params.gameId));
  app.post("/v1/games/:gameId/question-sets",async(r:any)=>service.addSet(host(r),r.params.gameId,r.body.questionSet,r.body.orderingMode));
  app.post("/v1/games/:gameId/question-sets/:setId/select",async(r:any)=>service.selectSet(host(r),r.params.gameId,r.params.setId));
  app.post("/v1/games/:gameId/questions/preview",async(r:any)=>service.preview(host(r),r.params.gameId));
  app.post("/v1/games/:gameId/questions/skip",async(r:any)=>service.skip(host(r),r.params.gameId));
  app.post("/v1/games/:gameId/questions/open",async(r:any)=>{service.open(host(r),r.params.gameId);return service.hostState(host(r),r.params.gameId);});
  app.post("/v1/games/:gameId/questions/close",async(r:any)=>service.close(host(r),r.params.gameId));
  app.post("/v1/games/:gameId/questions/:questionId/repeat",async(r:any)=>service.repeatQuestion(host(r),r.params.gameId,r.params.questionId));
  app.post("/v1/games/:gameId/end",async(r:any)=>service.end(host(r),r.params.gameId));
  app.post("/v1/games/:gameId/players/:playerId/kick",async(r:any)=>service.kickFromGame(host(r),r.params.gameId,r.params.playerId));
  app.post("/v1/games/:gameId/players/:playerId/score-adjustment",async(r:any)=>service.adjustScore(host(r),r.params.gameId,r.params.playerId,r.body.delta,r.body.reason));
  app.get("/v1/series",async(r:any)=>service.listSeries(host(r)));
  app.post("/v1/series",async(r:any)=>service.createSeries(host(r),r.body.name));
  app.get("/v1/series/:seriesId",async(r:any)=>service.seriesState(host(r),r.params.seriesId));
  app.post("/v1/series/:seriesId/games",async(r:any)=>service.startNextGameInSeries(host(r),r.params.seriesId,r.body));
  app.post("/v1/series/:seriesId/end",async(r:any)=>service.endSeries(host(r),r.params.seriesId));
  app.post("/v1/series/:seriesId/participants/:participantId/remove",async(r:any)=>service.removeFromSeries(host(r),r.params.seriesId,r.params.participantId));
  app.post("/v1/player/join",async(r:any)=>service.join(r.body.joinCode,r.body.displayName));
  app.post("/v1/player/reconnect",async(r:any)=>service.playerReconnect(r.body.reconnectToken));
  app.post("/v1/player/answer",async(r:any)=>service.answer(r.body.reconnectToken,r.body.questionId,r.body.answerId));
  app.register((websocketApp:any,_options:any,done:any)=>{websocketApp.get("/v1/ws",{websocket:true},(socket:any)=>{
    let authenticated=false, playerToken:string|undefined, gameId:string|undefined, seriesId:string|undefined;
    const push=()=>{ if(!playerToken) return; try{ const x=service.playerReconnect(playerToken); gameId=x.gameId??undefined; seriesId=(x.game as any)?.seriesId??undefined; socket.send(JSON.stringify({type:"player.state",game:x.game})); }catch(e){ const error=e instanceof ServiceError?e:new ServiceError(500,"internal_error","Unexpected error."); try{socket.send(JSON.stringify({type:"error",code:error.code,message:error.message}));}finally{socket.close();} } };
    const onGameChanged=(changed:string)=>{ if(changed===gameId) push(); };
    // Series-scoped tokens must transition automatically when the host starts the next game — no manual rejoin.
    const onSeriesChanged=(changed:string)=>{ if(changed===seriesId) push(); };
    service.events.on("game",onGameChanged); service.events.on("series",onSeriesChanged);
    socket.on("close",()=>{ service.events.off("game",onGameChanged); service.events.off("series",onSeriesChanged); });
    socket.on("message",(raw:Buffer)=>{try{const message=JSON.parse(raw.toString());if(!authenticated){if(message.protocolVersion!==1)throw new ServiceError(426,"unsupported_protocol","Protocol version 1 is required.");if(message.accessToken){service.authenticate(message.accessToken);authenticated=true;socket.send(JSON.stringify({type:"authenticated",role:"host"}));}else if(message.reconnectToken){authenticated=true;const token:string=message.reconnectToken;playerToken=token;const x=service.playerReconnect(token);gameId=x.gameId??undefined;seriesId=(x.game as any)?.seriesId??undefined;socket.send(JSON.stringify({type:"authenticated",role:"player",game:x.game}));}else throw new ServiceError(401,"authentication_required","Authentication is required.");}else socket.send(JSON.stringify({type:"error",code:"use_http_commands"}));}catch(e){const error=e instanceof ServiceError?e:new ServiceError(400,"invalid_message","Invalid WebSocket message.");socket.send(JSON.stringify({type:"error",code:error.code,message:error.message}));socket.close();}});
  });done();});
  app.register(statik,{root:join(import.meta.dirname,"..","public"),prefix:"/"});
  app.get("/play/:joinCode",async(_r,reply)=>reply.sendFile("index.html"));
  return app;
}
declare module "fastify" { interface FastifyInstance { trivia: TriviaService; } }
