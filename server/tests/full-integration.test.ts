import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { TriviaService, ServiceError } from "../src/service.js";
import type { Config } from "../src/config.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const config:Config={databasePath:"",serverAccessPassword:"integration-server-password",tokenSecret:"integration-token-secret",registrationEnabled:true,publicBaseUrl:"https://trivia.example"};
const question=(n:number)=>({id:`11111111-1111-4111-8111-11111111111${n}`,question:`Integration question ${n}`,correctAnswer:`Correct ${n}`,incorrectAnswers:Array.from({length:9},(_,i)=>`Wrong ${n}-${i}`) as any,category:"Integration",tags:["e2e"]});
const set=(id:string,title:string):QuestionSet=>({format:"fftrivia-question-set",schemaVersion:1,id,title,description:"",author:"Kei Joi",version:"1.0.0",categories:["Integration"],tags:["e2e"],questions:[question(1),question(2),question(3)]});

describe("full persistent cross-component contract",()=>{
  it("runs a 30-player game with stable layouts, queue switching, ownership, UTC, and restart",async()=>{
    const dir=mkdtempSync(join(tmpdir(),"mairs-e2e-")), path=join(dir,"trivia.sqlite");let db=openDatabase(path), service=new TriviaService(db,{...config,databasePath:path});
    try { const hostA=await service.register("integration-a","a sufficiently strong password"),hostB=await service.register("integration-b","a sufficiently strong password");const a=service.authenticate(hostA.accessToken),b=service.authenticate(hostB.accessToken);const original=set("22222222-2222-4222-8222-222222222222","Original"), alternative=set("33333333-3333-4333-8333-333333333333","Alternative");
      const game=service.createGame(a,{venueName:"Integration Test Venue",gameName:"Integration Test Game",questionSet:original,orderingMode:"shuffleOnce",scoring:{correctPoints:10,firstCorrectBonus:5}});expect(service.listGames(b)).toEqual([]);expect(()=>service.hostState(b,game.id)).toThrow(ServiceError);
      const players=Array.from({length:30},(_,i)=>service.join(game.joinCode,`Player ${i}`));expect(players).toHaveLength(30);const skipped=service.preview(a,game.id);service.skip(a,game.id);const opened=service.preview(a,game.id);expect(opened.id).not.toBe(skipped.id);service.open(a,game.id);
      const views=players.map(p=>service.playerReconnect(p.reconnectToken));for(const view of views){const q=view.game.question as any;expect(q.question).toBe(`Integration question ${opened.id.endsWith("1")?1:opened.id.endsWith("2")?2:3}`);expect(q.choices).toHaveLength(4);expect(JSON.stringify(q)).not.toMatch(/correct(answer|_answer)|isCorrect/i);expect(new Set(q.choices.map((x:any)=>x.id)).size).toBe(4);}
      const snapshots=views.map(v=>JSON.stringify(v.game.question));for(let i=0;i<players.length;i++){const q=views[i].game.question as any;const answer=q.choices.find((x:any)=>x.text.startsWith("Correct"))!;service.answer(players[i].reconnectToken,q.id,answer.id);}const state=service.hostState(a,game.id);expect(state.players).toHaveLength(30);expect(state.players.filter(p=>p.score===15)).toHaveLength(1);expect(db.prepare("SELECT receipt_order,received_at FROM player_answers WHERE game_id=? ORDER BY receipt_order").all(game.id)).toHaveLength(30);const answerTimes=db.prepare("SELECT received_at FROM player_answers WHERE game_id=?").all(game.id) as {received_at:string}[];expect(answerTimes.every(x=>/Z$/.test(x.received_at))).toBe(true);
      for(let i=0;i<5;i++)expect(JSON.stringify(service.playerReconnect(players[i].reconnectToken).game.question)).toBe(snapshots[i]);service.close(a,game.id);const added=service.addSet(a,game.id,alternative,"inOrder");service.selectSet(a,game.id,added.gameSetId);expect(service.hostState(a,game.id).players).toHaveLength(30);const originalSet=db.prepare("SELECT id FROM game_question_sets WHERE game_id=? AND source_set_id=?").get(game.id,original.id) as {id:string};service.selectSet(a,game.id,originalSet.id);expect(()=>service.preview(a,game.id)).not.toThrow();service.end(a,game.id);
      db.close();db=openDatabase(path);service=new TriviaService(db,{...config,databasePath:path});expect(service.hostState(a,game.id).state).toBe("finished");expect(db.prepare("SELECT COUNT(*) AS n FROM game_history WHERE game_id=?").get(game.id)).toMatchObject({n:expect.any(Number)});
    } finally { db.close();rmSync(dir,{recursive:true,force:true}); }
  });
});
