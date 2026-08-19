import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { TriviaService, ServiceError } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const set: QuestionSet = { format:"fftrivia-question-set",schemaVersion:1,id:"1d968d2e-1d78-42be-82fe-3a2654be3660",title:"Set",description:"",author:"Test",version:"1",categories:[],tags:[],questions:["a","b"].map((id,n)=>({id:`a409f176-7e28-45e8-84db-fab34c9efea${n}`,question:`Q${n}`,correctAnswer:`Correct ${n}`,incorrectAnswers:["1","2","3","4","5","6","7","8","9"].map(x=>`${x}-${n}`) as any,category:null,tags:[]})) };
let service:TriviaService;
beforeEach(()=>{service=new TriviaService(openDatabase(":memory:"),{databasePath:":memory:",serverAccessPassword:"server-secret",tokenSecret:"token-secret",registrationEnabled:true,publicBaseUrl:"http://test"});});
async function host(name:string){return service.register(name,"a sufficiently strong password");}

describe("authoritative game lifecycle",()=>{
  it("stores a 0–15 second limit and automatically closes timed questions",async()=>{
    const h=await host("timed-host"), owner=service.authenticate(h.accessToken);
    expect(()=>service.createGame(owner,{venueName:"Venue",gameName:"Invalid",questionSet:set,orderingMode:"inOrder",questionTimeLimitSeconds:16})).toThrow(ServiceError);
    const game=service.createGame(owner,{venueName:"Venue",gameName:"Timed",questionSet:set,orderingMode:"inOrder",questionTimeLimitSeconds:1});
    expect(game.questionTimeLimitSeconds).toBe(1);
    const player=service.join(game.joinCode,"Timer"); service.preview(owner,game.id); service.open(owner,game.id);
    expect((service.playerReconnect(player.reconnectToken).game.question as any)?.closesAt).toBeTruthy();
    await new Promise(resolve=>setTimeout(resolve,1100));
    expect(service.hostState(owner,game.id).state).toBe("results");
  });

  it("allows a host account password of any length",async()=>{
    const account=await service.register("short-password-host","");
    expect(service.authenticate(account.accessToken)).toMatch(/^[0-9a-f-]{36}$/);
    expect((await service.login("short-password-host","")).user.username).toBe("short-password-host");
  });

  it("isolates owners and requires server access separately from host identity",async()=>{
    expect(service.verifyServerAccess("server-secret")).toBe(true);expect(service.verifyServerAccess("wrong")).toBe(false);
    const a=await host("host-a"), b=await host("host-b"); const owner=service.authenticate(a.accessToken);
    const game=service.createGame(owner,{venueName:"The Venue",gameName:"Friday",questionSet:set,orderingMode:"shuffleOnce"});
    expect(service.listGames(service.authenticate(b.accessToken))).toEqual([]);
    expect(()=>service.hostState(service.authenticate(b.accessToken),game.id)).toThrow(ServiceError);
    expect(game.playerUrl).toBe("http://test/play/"+game.joinCode);
  });

  it("persists personalized opaque layouts, scores first correct, and preserves skipped progress",async()=>{
    const h=await host("host-c"), owner=service.authenticate(h.accessToken);
    const game=service.createGame(owner,{venueName:"Venue",gameName:"Game",questionSet:set,orderingMode:"inOrder",scoring:{correctPoints:10,firstCorrectBonus:5}});
    const p1=service.join(game.joinCode,"One"),p2=service.join(game.joinCode,"Two");
    const firstPreview=service.preview(owner,game.id); expect(firstPreview.id).toBe(set.questions[0].id);
    service.skip(owner,game.id); expect(service.preview(owner,game.id).id).toBe(set.questions[1].id);
    service.open(owner,game.id);
    const a=service.playerReconnect(p1.reconnectToken).game, b=service.playerReconnect(p2.reconnectToken).game;
    const qa=a.question as {choices:{id:string;text:string}[]}, qb=b.question as {choices:{id:string;text:string}[]};
    expect(qa.choices).toHaveLength(4);expect(JSON.stringify(a.question)).not.toContain("correctAnswer");
    expect(service.playerReconnect(p1.reconnectToken).game.question).toEqual(a.question);
    const aCorrect=qa.choices.find(c=>c.text==="Correct 1")!, bIncorrect=qb.choices.find(c=>c.text!=="Correct 1")!;
    expect(()=>service.selectSet(owner,game.id,"bad")).toThrow(ServiceError);
    service.answer(p1.reconnectToken,set.questions[1].id,aCorrect.id);service.answer(p2.reconnectToken,set.questions[1].id,bIncorrect.id);
    const state=service.hostState(owner,game.id);expect(state.players.find(p=>p.displayName==="One")?.score).toBe(15);expect(state.players.find(p=>p.displayName==="Two")?.incorrectCount).toBe(1);
    service.close(owner,game.id);const result=service.playerReconnect(p1.reconnectToken).game as any;expect(result.result).toMatchObject({correctAnswer:"Correct 1",selectedAnswer:"Correct 1",isCorrect:true,pointsAwarded:15});expect(()=>service.answer(p1.reconnectToken,set.questions[1].id,aCorrect.id)).toThrow(ServiceError);
  });
});
