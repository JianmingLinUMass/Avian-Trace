// Test-only fixture routes; these are not exposed by the application server.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const app=express();
app.use("/api",async(req,res)=>{
  try {const response=await fetch("http://127.0.0.1:3000/api"+req.url);res.status(response.status).type(response.headers.get("content-type")||"text/plain").send(await response.text());}
  catch(error){res.status(502).send(error.message);}
});
app.get("/view-lifecycle.html",(req,res)=>res.sendFile(path.join(root,"tests/browser/view-lifecycle.html")));
app.get("/view-lifecycle.js",(req,res)=>res.sendFile(path.join(root,"tests/browser/view-lifecycle.js")));
for (const name of ["searchable-filters.html","searchable-filters.js","compact-cases.js","compact-preview.html","compact-preview.js","compact-regression.html","compact-regression.js","dashboard-regression.html","dashboard-regression.js"]) app.get("/"+name,(req,res)=>res.sendFile(path.join(root,"tests/browser",name)));
app.use(express.static(path.join(root,"frontend")));
app.listen(3001,"127.0.0.1",()=>console.log("Lifecycle regression fixture: http://127.0.0.1:3001/view-lifecycle.html"));
