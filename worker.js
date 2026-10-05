const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const idPattern=/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const rootPattern=/^root-(0[0-9]|1[0-6])$/;
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/forms'){
   try{
    if(!env.BUCKET)return json({error:'Archive unavailable'},503);
    if(request.method==='GET'){
     const cursor=url.searchParams.get('cursor')||undefined;
     const listing=await env.BUCKET.list({prefix:'forms/',limit:32,...(cursor?{cursor}:{})});
     const forms=(await Promise.all(listing.objects.map(async o=>{const item=await env.BUCKET.get(o.key);return item?await item.json():null}))).filter(Boolean);
     return json({forms,cursor:listing.truncated?listing.cursor:null});
    }
    if(request.method==='POST'){
     const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return json({error:'Origin mismatch'},403);
     if(Number(request.headers.get('Content-Length'))>240000)return json({error:'Form too large'},413);
     const text=await request.text();if(text.length>240000)return json({error:'Form too large'},413);
     const record=JSON.parse(text);
     if(!idPattern.test(record.id)||!Array.isArray(record.parents)||record.parents.length<1||record.parents.length>2||!['join','cut','intersect','negative','nest','repeat','split','stretch'].includes(record.operation)||typeof record.png!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(record.png))return json({error:'Invalid descendant'},400);
     const png=atob(record.png.slice(22));
     const dim=i=>((png.charCodeAt(i)<<24)|(png.charCodeAt(i+1)<<16)|(png.charCodeAt(i+2)<<8)|png.charCodeAt(i+3))>>>0;
     if(png.slice(0,8)!=='\x89PNG\r\n\x1a\n'||dim(16)!==512||dim(20)!==512)return json({error:'Invalid silhouette'},400);
     if(!Array.isArray(record.transforms)||record.transforms.length!==2||record.transforms.some(t=>!t||['x','y','rotation','sx','sy'].some(k=>!Number.isFinite(t[k])||Math.abs(t[k])>4)))return json({error:'Invalid transform'},400);
     let generation=0;
     for(const parent of record.parents){
      if(rootPattern.test(parent))continue;
      if(!idPattern.test(parent)||parent===record.id)return json({error:'Invalid parent'},400);
      const ancestor=await env.BUCKET.get('forms/'+parent+'.json');if(!ancestor)return json({error:'Parent not archived'},409);
      const data=await ancestor.json();generation=Math.max(generation,data.generation);
     }
     const existing=await env.BUCKET.get('forms/'+record.id+'.json');if(existing){const old=await existing.json();return json({id:old.id,generation:old.generation})}
     const saved={id:record.id,parents:record.parents,operation:record.operation,transforms:record.transforms,png:record.png,generation:generation+1,createdAt:new Date().toISOString()};
     await env.BUCKET.put('forms/'+record.id+'.json',JSON.stringify(saved),{httpMetadata:{contentType:'application/json'}});
     return json({id:saved.id,generation:saved.generation},201);
    }
    return json({error:'Method not allowed'},405);
   }catch(error){console.error('Archive error',error);return json({error:'Archive temporarily unavailable'},503)}
  }
  if(!env.ASSETS)return new Response('Static assets unavailable',{status:503});
  return env.ASSETS.fetch(request);
 }
};
