/* persistent collaboration runtime: server is the sole state source */
(function (global) {
  "use strict";
  const CODE=/^\d{8}$/, WAIT=1500, text=v=>String(v==null?"":v).trim();
  const STATUS={to_book:"待预订",confirmed:"已确认",verify:"临行核验",candidate:"候选",cancelled:"已取消"};
  const BOOKING={to_book:"待预订",confirmed:"已预订",verify:"待核验"};
  const key=id=>"travel-guide-collab:"+id;
  const read=id=>{try{return JSON.parse(localStorage.getItem(key(id))||"null")}catch(_){return null}};
  const write=(id,v)=>localStorage.setItem(key(id),JSON.stringify(v));
  const remove=id=>localStorage.removeItem(key(id));
  const token=()=>global.crypto?.randomUUID?.().replace(/-/g,"_")||("d_"+Math.random().toString(36).slice(2)+Date.now().toString(36));
  const booking=n=>n.classList.contains("booking-status")||text(n.dataset.executionId).startsWith("booking:");
  function refresh(input){input.closest("[data-checklist]")?.dispatchEvent(new CustomEvent("guide:checklist-refresh",{bubbles:true}))}
  function applyStatus(n,row){const limited=booking(n), labels=limited?BOOKING:STATUS, v=labels[row.booking_status]?row.booking_status:"verify";n.className=(limited?"booking-status":"execution-status")+" is-"+v;n.dataset.bookingStatus=v;n.dataset.executionNote=text(row.note);n.textContent=labels[v];n.setAttribute("aria-pressed",String(v==="confirmed"));const note=n.dataset.executionId&&document.querySelector('[data-execution-note-for="'+CSS.escape(n.dataset.executionId)+'"]');if(note){note.textContent=text(row.note);note.hidden=!text(row.note)}}
  function applyCheck(n,checked){n.checked=!!checked;n.closest(".guide-checklist-item")?.classList.toggle("is-complete",n.checked);refresh(n)}
  function ui(){if(document.querySelector("[data-guide-collab]"))return;const n=document.createElement("div");n.className="guide-collab";n.dataset.guideCollab="";n.innerHTML='<button type="button" class="guide-collab-trigger" data-collab-open>编辑行程</button><dialog class="guide-collab-dialog" data-collab-dialog><form method="dialog" class="guide-collab-card"><button type="button" class="guide-collab-close" data-collab-close aria-label="关闭">×</button><h2>共同编辑行程</h2><p>首次在此设备编辑，请输入 8 位数字协作码。</p><input inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="one-time-code" placeholder="输入 8 位数字码" data-collab-code><p class="guide-collab-message" data-collab-message aria-live="polite"></p><div class="guide-collab-actions"><button type="button" data-collab-join>进入编辑</button><button type="button" data-collab-leave>保持只读</button></div></form></dialog><button type="button" class="guide-collab-retry" data-collab-retry hidden>重试保存</button><button type="button" class="guide-collab-exit" data-collab-exit hidden>退出编辑</button>';document.body.append(n)}
  function message(s,bad){const n=document.querySelector("[data-collab-message]");if(n){n.textContent=s||"";n.classList.toggle("is-error",!!bad)}}
  function dialog(open){const d=document.querySelector("[data-collab-dialog]");if(!d)return;if(open){d.showModal?.()||d.setAttribute("open","");document.querySelector("[data-collab-code]")?.focus()}else d.close?.()||d.removeAttribute("open")}
  function status(s){const b=document.querySelector("[data-collab-open]"),x=document.querySelector("[data-collab-exit]"),r=document.querySelector("[data-collab-retry]");if(b)b.textContent=s;if(x)x.hidden=s!=="编辑中 · 已同步";if(r)r.hidden=!s.startsWith("保存失败")}
  async function library(){if(global.supabase?.createClient)return global.supabase;const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";document.head.append(s);for(let i=0;i<80;i++){if(global.supabase?.createClient)return global.supabase;await new Promise(r=>setTimeout(r,100))}throw Error("协作组件加载失败")}
  async function init(cfg){
    if(!cfg?.projectUrl||!cfg?.publishableKey||!cfg?.guideId)return {enabled:false};ui();const sb=(await library()).createClient(cfg.projectUrl,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});let editable=false,timer=0,dirty=new Map(),device=null,flushPromise=null,realtimeChannel=null;
    const identity=async()=>{let r=await sb.auth.getSession();if(r.data.session)return r.data.session;r=await sb.auth.signInAnonymously();if(r.error)throw r.error;return r.data.session};
    const setEdit=v=>{editable=v;document.body.dataset.guideCollab=v?"editing":"readonly";status(v?"编辑中 · 已同步":"编辑行程")};
    const queue=v=>{dirty.set(v.kind+":"+v.id,{...v,at:new Date().toISOString()});status("保存中…");clearTimeout(timer);timer=setTimeout(flush,WAIT)};
    const applyCustom=row=>{if(!row?.item_id)return;const selector='input[data-check="'+CSS.escape(row.item_id)+'"]',existing=document.querySelector(selector);if(row.deleted){if(existing){existing.closest(".guide-checklist-item")?.remove();document.querySelector("[data-checklist]")?.dispatchEvent(new CustomEvent("guide:checklist-refresh",{bubbles:true}))}return}if(existing){const label=existing.closest(".guide-checklist-item")?.querySelector("[data-check-label]");if(label)label.textContent=text(row.text);applyCheck(existing,row.checked);return}const list=document.querySelector("[data-checklist-items]");if(!list)return;const line=document.createElement("label"),input=document.createElement("input"),label=document.createElement("span"),del=document.createElement("button");line.className="guide-checklist-item is-custom";input.type="checkbox";input.dataset.check=row.item_id;label.dataset.checkLabel="true";label.textContent=text(row.text);del.type="button";del.className="guide-checklist-remove";del.textContent="删除";del.addEventListener("click",()=>{line.remove();document.querySelector("[data-checklist]")?.dispatchEvent(new CustomEvent("guide:checklist-refresh",{bubbles:true}));document.dispatchEvent(new CustomEvent("guide:checklist-custom-remove",{detail:{id:row.item_id}}))});line.append(input,label,del);list.append(line);applyCheck(input,row.checked)};
    const load=async()=>{const [e,c,x]=await Promise.all([sb.from("guide_execution_state").select("entity_id,booking_status,note").eq("guide_id",cfg.guideId),sb.from("guide_checklist_state").select("item_id,checked").eq("guide_id",cfg.guideId),sb.from("guide_custom_checklist").select("item_id,text,checked,deleted").eq("guide_id",cfg.guideId)]);if(e.error||c.error||x.error)throw(e.error||c.error||x.error);(e.data||[]).forEach(row=>{const n=document.querySelector('[data-execution-id="'+CSS.escape(row.entity_id)+'"]');if(n)applyStatus(n,row)});(x.data||[]).forEach(applyCustom);(c.data||[]).forEach(row=>{const n=document.querySelector('input[data-check="'+CSS.escape(row.item_id)+'"]');if(n)applyCheck(n,row.checked)})};
    const rpcFor=v=>v.kind==="flights"?["replace_guide_flight_records",{p_guide_id:cfg.guideId,p_records:v.records,p_device_token:device}]:v.kind==="execution"?["save_guide_execution_state",{p_guide_id:cfg.guideId,p_entity_id:v.id,p_entity_type:v.entityType||"activity",p_booking_status:v.state,p_note:v.note,p_client_updated_at:v.at,p_device_token:device}]:v.kind==="check"?["save_guide_checklist_state",{p_guide_id:cfg.guideId,p_item_id:v.id,p_checked:v.checked,p_client_updated_at:v.at,p_device_token:device}]:["save_guide_custom_checklist",{p_guide_id:cfg.guideId,p_item_id:v.id,p_text:v.text,p_checked:v.checked,p_deleted:v.deleted,p_client_updated_at:v.at,p_device_token:device}];
    const pending=(kind,id)=>dirty.has(kind+":"+id);
    const applyExecution=row=>{if(!row?.entity_id||pending("execution",row.entity_id))return;const n=document.querySelector('[data-execution-id="'+CSS.escape(row.entity_id)+'"]');if(n)applyStatus(n,row)};
    const applyChecklist=row=>{if(!row?.item_id||pending("check",row.item_id))return;const n=document.querySelector('input[data-check="'+CSS.escape(row.item_id)+'"]');if(n)applyCheck(n,row.checked)};
    const applyRealtimeCustom=row=>{if(!row?.item_id||pending("custom",row.item_id))return;applyCustom(row)};
    const subscribe=()=>{if(realtimeChannel)return;realtimeChannel=sb.channel("guide-collab:"+cfg.guideId).on("postgres_changes",{event:"*",schema:"public",table:"guide_execution_state",filter:"guide_id=eq."+cfg.guideId},payload=>applyExecution(payload.new)).on("postgres_changes",{event:"*",schema:"public",table:"guide_checklist_state",filter:"guide_id=eq."+cfg.guideId},payload=>applyChecklist(payload.new)).on("postgres_changes",{event:"*",schema:"public",table:"guide_custom_checklist",filter:"guide_id=eq."+cfg.guideId},payload=>applyRealtimeCustom(payload.new)).subscribe(state=>{if(state==="CHANNEL_ERROR"||state==="TIMED_OUT")message("实时同步暂不可用；保存仍正常，刷新页面可读取他人修改。",true)})};
    // 每次入队创建新对象；只确认本次发送的对象，不用可能重复/回拨的时钟辨认修改。
    const flightNotice=(message,state)=>document.dispatchEvent(new CustomEvent("guide:flight-records-sync-status",{detail:{message,state}}));
    const flush=()=>{clearTimeout(timer);if(flushPromise)return flushPromise;flushPromise=(async()=>{while(dirty.size){status("保存中…");const jobs=[...dirty.values()];let out;try{out=await Promise.all(jobs.map(v=>{const [f,a]=rpcFor(v);return sb.rpc(f,a)}))}catch(error){status("保存失败 · 重试");message("保存失败："+(error.message||"网络异常"),true);if(dirty.has("flights:all"))flightNotice("航班信息同步失败，请点击重试保存。","error");return false}const fail=out.find(x=>x.error);if(fail){status("保存失败 · 重试");message("保存失败："+fail.error.message,true);if(dirty.has("flights:all"))flightNotice("航班信息同步失败，请点击重试保存。","error");return false}out.forEach((r,i)=>{const row=r.data,v=jobs[i],key=v.kind+":"+v.id,current=dirty.get(key);if(current!==v)return;if(row){if(v.kind==="flights"){flightNotice("航班信息已同步；图片仍仅保存在当前浏览器。","success")}else if(v.kind==="execution"){const n=document.querySelector('[data-execution-id="'+CSS.escape(v.id)+'"]');if(n)applyStatus(n,row)}else if(v.kind==="check"){const n=document.querySelector('input[data-check="'+CSS.escape(v.id)+'"]');if(n)applyCheck(n,row.checked)}else applyCustom(row)}dirty.delete(key);if(v.kind==="flights")document.dispatchEvent(new CustomEvent("guide:flight-records-synced"))})}message("",false);status("编辑中 · 已同步");return true})().finally(()=>{flushPromise=null});return flushPromise};
    const enter=async code=>{await identity();device=device||token();let r=await sb.rpc("bootstrap_guide_collab",{p_guide_id:cfg.guideId,p_edit_code:code,p_device_token:device});if(r.error)r=await sb.rpc("join_guide_collab",{p_guide_id:cfg.guideId,p_edit_code:code,p_device_token:device});if(r.error)throw r.error;write(cfg.guideId,{roomId:cfg.guideId,deviceToken:device});setEdit(true);subscribe();await load()};
    const restore=async()=>{const saved=read(cfg.guideId);if(!saved?.deviceToken||saved.roomId!==cfg.guideId)return;try{await identity();device=saved.deviceToken;const r=await sb.rpc("restore_guide_collab",{p_guide_id:cfg.guideId,p_device_token:device});if(r.error||!r.data){remove(cfg.guideId);return}setEdit(true);subscribe();await load()}catch(_){setEdit(false)}};
    document.addEventListener("click",async e=>{const n=e.target.closest("[data-execution-status]");if(n){if(!editable){message("请输入 8 位数字码后编辑。",false);dialog(true);return}let next,note=n.dataset.executionNote||"";if(booking(n)){const now=n.dataset.bookingStatus||"to_book";next=now==="confirmed"?"to_book":now==="to_book"?"verify":"confirmed"}else{const answer=global.prompt("预订状态：待预订 / 已确认 / 候选 / 临行核验 / 已取消",STATUS[n.dataset.bookingStatus]||"");if(answer===null)return;const map={待预订:"to_book",已确认:"confirmed",候选:"candidate",临行核验:"verify",已取消:"cancelled"};next=map[text(answer)]||text(answer).toLowerCase();if(!STATUS[next]){message("未识别状态，未保存。",true);return}note=global.prompt("执行备注（可留空）",note);if(note===null)return}applyStatus(n,{booking_status:next,note});queue({kind:"execution",id:n.dataset.executionId,entityType:n.dataset.executionType,state:next,note});return}if(e.target.closest("[data-collab-open]")){dialog(true);return}if(e.target.closest("[data-collab-retry]")){await flush();return}if(e.target.closest("[data-collab-close],[data-collab-leave]")){dialog(false);return}if(e.target.closest("[data-collab-exit]")){if(!(await flush())){message("网络异常，最新修改未保存。",true);return}await sb.rpc("leave_guide_collab",{p_guide_id:cfg.guideId,p_device_token:device});if(realtimeChannel){await sb.removeChannel(realtimeChannel);realtimeChannel=null}remove(cfg.guideId);await sb.auth.signOut({scope:"local"});device=null;setEdit(false);message("已退出此设备的编辑模式。",false)}});
    document.addEventListener("change",e=>{const n=e.target.closest('input[type="checkbox"][data-check]');if(n&&editable)queue({kind:"check",id:n.dataset.check,checked:n.checked})});
    document.addEventListener("guide:checklist-custom-add",e=>{const x=e.detail?.item;if(editable&&x)queue({kind:"custom",id:x.id,text:x.text,checked:false,deleted:false})});
    document.addEventListener("guide:checklist-custom-remove",e=>{const id=e.detail?.id;if(editable&&id)queue({kind:"custom",id,text:"已删除",checked:false,deleted:true})});
    document.querySelector("[data-collab-join]")?.addEventListener("click",async()=>{const c=text(document.querySelector("[data-collab-code]")?.value);if(!CODE.test(c)){message("请输入 8 位数字码。",true);return}try{status("正在连接…");await enter(c);dialog(false)}catch(e){setEdit(false);message("无法进入编辑："+(e.message||"请检查数字码与网络。"),true)}});
    global.addEventListener("beforeunload",event=>{if(dirty.size||flushPromise){event.preventDefault();event.returnValue=""}});global.addEventListener("pagehide",()=>{void flush()});document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")void flush()});await restore();return {flush,client:sb,hasPendingFlights:()=>dirty.has("flights:all"),saveFlights:records=>{if(!editable)return Promise.resolve(false);queue({kind:"flights",id:"all",records});return flush()}};
  }
  global.TravelGuideCollaboration=Object.freeze({init});
})(window);

/* Flight metadata shares the main client, save queue and unload/exit safeguards. */
(function(global){
  "use strict";
  function init(cfg,ready){
    let api, channel=null, loading=null, starting=null, requested=false, generation=0, writeRevision=0;
    const editing=()=>document.body.dataset.guideCollab==="editing";
    const notify=(message,state="")=>document.dispatchEvent(new CustomEvent("guide:flight-records-sync-status",{detail:{message,state}}));
    const record=value=>{
      const clean=(global.TravelGuideInteractions?.sanitizeFlightRecord||(value=>({id:String(value.id||'').trim(),legLabel:/^(去程|返程)$/.test(value.legLabel)?value.legLabel:'',flightNumber:String(value.flightNumber||'').trim().toUpperCase().replace(/\s+/g,''),airline:String(value.airline||'').trim(),departureDate:String(value.departureDate||'').trim(),arrivalDate:String(value.arrivalDate||'').trim(),departureTime:String(value.departureTime||'').trim(),arrivalTime:String(value.arrivalTime||'').trim(),departureCode:String(value.departureCode||'').trim().toUpperCase(),departureAirport:String(value.departureAirport||'').trim(),departureTerminal:String(value.departureTerminal||'').trim(),arrivalCode:String(value.arrivalCode||'').trim().toUpperCase(),arrivalAirport:String(value.arrivalAirport||'').trim(),arrivalTerminal:String(value.arrivalTerminal||'').trim(),durationMinutes:Number.isInteger(value.durationMinutes)?value.durationMinutes:null,seat:String(value.seat||'').trim(),gate:String(value.gate||'').trim(),baggageClaim:String(value.baggageClaim||'').trim(),connection:value.connection&&typeof value.connection==='object'?{airportCode:String(value.connection.airportCode||'').trim().toUpperCase(),airport:String(value.connection.airport||'').trim(),durationMinutes:Number.isInteger(value.connection.durationMinutes)?value.connection.durationMinutes:null}:null,detailUrl:/^https:\/\//i.test(String(value.detailUrl||'').trim())?String(value.detailUrl).trim():''})))(value);
      const {imageKey,imageRedacted,groupId,shared,dateHint,...metadata}=clean;
      return metadata;
    };
    const complete=value=>value.id&&value.flightNumber&&value.airline&&value.departureAirport&&value.arrivalAirport;
    const load=()=>{
      requested=true;
      if(loading||!api||!editing()||api.hasPendingFlights())return loading;
      const epoch=generation;
      loading=(async()=>{
        while(requested&&editing()&&epoch===generation&&!api.hasPendingFlights()){
          requested=false;
          const revision=writeRevision;
          try{
            const out=await api.client.from("guide_flight_records").select("record_id,flight_data").eq("guide_id",cfg.guideId).order("record_index",{ascending:true}).order("updated_at",{ascending:true}).order("record_id",{ascending:true});
            if(out.error)throw out.error;
            if(!editing()||epoch!==generation)return;
            if(revision!==writeRevision||api.hasPendingFlights()){requested=true;continue;}
            document.dispatchEvent(new CustomEvent("guide:flight-records-remote",{detail:{records:(out.data||[]).map(row=>record({...row.flight_data,id:row.record_id}))}}));
          }catch(error){notify("航班信息同步暂不可用："+(error.message||"网络异常"),"error");break;}
        }
      })().finally(()=>{loading=null;});
      return loading;
    };
    const start=()=>{
      if(starting)return starting;
      starting=(async()=>{
        api=await ready;
        if(!api?.client||!editing())return;
        if(!channel){
          channel=api.client.channel("guide-flights:"+cfg.guideId).on("postgres_changes",{event:"*",schema:"public",table:"guide_flight_records",filter:"guide_id=eq."+cfg.guideId},()=>{void load()});
          channel.subscribe(state=>{
            if(state==="SUBSCRIBED")void load();
            else if(state==="CHANNEL_ERROR"||state==="TIMED_OUT")notify("航班实时同步暂不可用，请刷新页面重试。","error");
          });
        }
        await load();
      })().catch(error=>notify("航班信息同步暂不可用："+(error.message||"网络异常"),"error")).finally(()=>{starting=null;});
      return starting;
    };
    document.addEventListener("guide:flight-records-save",async event=>{
      if(!editing())return;
      const records=(event.detail?.records||[]).map(record);
      // Never replace a full remote group with only the successfully recognized subset.
      if(!records.length||records.some(value=>!complete(value))){notify("航段信息不完整，本次仅保存在当前浏览器，未覆盖共享机票。");return;}
      try{
        api=api||await ready;
        if(!api?.saveFlights||!editing())throw Error("请先开启共同编辑");
        writeRevision++;
        notify("正在同步航班信息…");
        await api.saveFlights(records);
      }catch(error){notify("航班信息同步失败："+(error.message||"网络异常"),"error");}
    });
    document.addEventListener("guide:flight-records-synced",()=>{void load();});
    const observer=new MutationObserver(()=>{
      if(editing()){void start();return;}
      generation++;requested=false;
      if(channel){void api?.client.removeChannel(channel);channel=null;}
    });
    observer.observe(document.body,{attributes:true,attributeFilter:["data-guide-collab"]});
    void start();
    return {refresh:load};
  }
  global.TravelGuideFlightCollaboration=Object.freeze({init});
})(window);

window.GuideFlightSyncConfig=Object.freeze({"projectUrl":"https://wbzxhcfiplsvipyemabe.supabase.co","publishableKey":"sb_publishable_hOxnt_8vvjmBIZUkw796Fg_bixi5iki","guideId":"cbb599ebc6ef"});
window.GuideCollaborationReady=window.TravelGuideCollaboration.init(window.GuideFlightSyncConfig);
window.GuideFlightCollaborationReady=window.TravelGuideFlightCollaboration.init(window.GuideFlightSyncConfig,window.GuideCollaborationReady);
