(function(){const a="knowledgeBaseRegistry";function b(){try{const b=localStorage.getItem(a);return b?JSON.parse(b):{}}catch(a){return console.error("Error loading saved knowledge bases:",a),{}}}function c(b){try{localStorage.setItem(a,JSON.stringify(b))}catch(a){console.error("Error saving knowledge bases:",a)}}const d=b();let e=null;window.KnowledgeBaseAdapter={getRegisteredBases:function(){return d},getCurrentKB:function(){return e},registerBase:function(a,b,e,f){d[a]={name:b,url:e,global:f},c(d);const g=document.getElementById("source-select");if(g&&!g.querySelector(`option[value="${a}"]`)){const c=document.createElement("option");c.value=a,c.textContent=b,g.appendChild(c)}return console.log(`Registered knowledge base: ${b} [${a}]`),this},deleteKnowledgeBase:function(a){return d[a]&&(delete d[a],c(d),console.log(`Deleted knowledge base: ${a}`)),this},loadKnowledgeBase:function(a,b){if(!d[a])return console.error(`Knowledge base not found: ${a}`),void b(!1);const c=d[a];if(console.log(`Loading knowledge base: ${c.name} from ${c.url}`),window[c.global]){if(console.log(`Using cached ${c.name} data`),window[c.global].features)e=window[c.global],b(!0);else if(window.KnowledgeBaseRegistry&&window.KnowledgeBaseRegistry.getCategoryFeatures){const c=a.split("-")[0]||a;this._adaptNewToOldStructure(c),b(!0)}else console.error(`Loaded object ${c.global} is not a valid knowledge base`),b(!1);return}window.KnowledgeBaseRegistry?this._loadKnowledgeBase(a,c,b):this._loadScript("https://yourserver.com/core/kb-registry.js",()=>{this._loadKnowledgeBase(a,c,b)},a=>{console.error(`Failed to load registry: ${a}`),b(!1)})},_loadKnowledgeBase:function(a,b,c){this._loadScript(b.url,()=>{if(window[b.global])console.log(`Successfully loaded ${b.name}`),e=window[b.global],c(!0);else if(window.KnowledgeBaseRegistry){const d=a.split("-")[0]||a,e=window.KnowledgeBaseRegistry.getCategoryFeatures(d);Object.keys(e).length>0?(this._adaptNewToOldStructure(d),c(!0)):(console.error(`Knowledge base ${b.name} loaded but not found in registry`),c(!1))}else console.error(`Failed to load knowledge base: ${b.name}`),c(!1)},a=>{console.error(`Error loading knowledge base: ${a}`),c(!1)})},_adaptNewToOldStructure:function(a){const b=window.KnowledgeBaseRegistry.getCategoryFeatures(a),c={name:a.charAt(0).toUpperCase()+a.slice(1),features:{},generatePrompt:function(c){return window.KnowledgeBaseRegistry.generatePrompt(a,c)}};for(const a in b){const d=b[a];c.features[a]={title:d.metadata.title,considerations:d.knowledgeBase.considerations||[],principles:d.knowledgeBase.principles||[],userStories:d.knowledgeBase.userStories||[]}}e=c},_loadScript:function(a,b,c){console.log(`Loading script: ${a}`);const d=document.createElement("script");d.src=a;const e=setTimeout(()=>{console.warn(`Script load timeout, trying alternative method: ${a}`),this._loadScriptWithFetch(a,b,c)},5e3);d.onload=()=>{clearTimeout(e),console.log(`Script loaded successfully: ${a}`),setTimeout(b,100)},d.onerror=()=>{clearTimeout(e),console.error(`Error loading script via standard method: ${a}`),this._loadScriptWithFetch(a,b,c)},document.head.appendChild(d)},_loadScriptWithFetch:async function(a,b,c){try{console.log(`Fetching script: ${a}`);const d=await fetch(a);if(!d.ok)throw new Error(`Network response was not ok: ${d.status}`);const e=await d.text();console.log("Script fetched, evaluating content...");try{new Function(e)(),console.log("Script evaluated successfully"),setTimeout(b,100)}catch(a){console.error(`Error evaluating script: ${a.message}`),c(`Failed to evaluate the loaded script. Error: ${a.message}`)}}catch(b){console.error(`Fetch error: ${b.message}`),c(`Failed to load script. Error: ${b.message}`)}}};const f=[{id:"research",name:"Research Best Practices",url:"https://yourserver.com/knowledge-bases/research/research-kb-core.js",global:"kbResearch"},{id:"accessibility",name:"Accessibility Guidelines",url:"https://yourserver.com/knowledge-bases/accessibility/accessibility-kb-core.js",global:"kbAccessibility"}];f.forEach(a=>{d[a.id]||window.KnowledgeBaseAdapter.registerBase(a.id,a.name,a.url,a.global)}),console.log("Knowledge Base Adapter initialized")})();