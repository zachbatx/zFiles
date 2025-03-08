// Pre-prompt Generator Controller Script
(function() {
    // Signal that controller loaded successfully
    if (window.PPGControllerLoaded) window.PPGControllerLoaded();
    
    // Knowledge base URLs
    const kbURLs = {
        accessibility: "https://zachbatx.github.io/zFiles/load_a11y.js",
        ux: "https://zachbatx.github.io/zFiles/load_ux.js"
    };
    
    // UI Variables
    let currentKB = null;
    
    // Log helper
    function log(message, isError = false) {
        const method = isError ? console.error : console.log;
        method('[Pre-prompt Generator] ' + message);
    }
    
    //===== LOADING VECTORS =====
    
    // 1. Standard script loading
    function loadScriptStandard(url, callback) {
        log("Trying standard script loading: " + url);
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => callback(true);
        script.onerror = () => callback(false);
        document.head.appendChild(script);
    }
    
    // 2. Blob URL loading
    function loadScriptViaBlob(url, callback) {
        log("Trying Blob URL method: " + url);
        fetch(url, { 
            mode: 'cors', 
            cache: 'no-cache', 
            redirect: 'follow',
            credentials: 'omit'
        })
        .then(response => response.text())
        .then(code => {
            const blob = new Blob([code], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const script = document.createElement('script');
            script.src = blobUrl;
            script.onload = function() {
                URL.revokeObjectURL(blobUrl);
                callback(true);
            };
            script.onerror = function() {
                URL.revokeObjectURL(blobUrl);
                callback(false);
            };
            document.head.appendChild(script);
        })
        .catch(err => {
            log("Blob URL method failed: " + err.message, true);
            callback(false);
        });
    }
    
    // 3. Direct script evaluation
    function loadScriptViaEval(url, callback) {
        log("Trying direct evaluation method: " + url);
        fetch(url, { 
            mode: 'cors', 
            cache: 'no-cache', 
            redirect: 'follow',
            credentials: 'omit'
        })
        .then(response => response.text())
        .then(code => {
            try {
                // Execute the script content
                new Function(code)();
                callback(true);
            } catch (error) {
                log("Eval execution failed: " + error.message, true);
                callback(false);
            }
        })
        .catch(err => {
            log("Eval fetch failed: " + err.message, true);
            callback(false);
        });
    }
    
    // 4. Web Worker loading
    function loadScriptViaWorker(url, callback) {
        log("Trying Web Worker method: " + url);
        try {
            const workerCode = `
                self.addEventListener('message', function(e) {
                    if (e.data.url) {
                        fetch(e.data.url, { 
                            mode: 'cors',
                            cache: 'no-cache'
                        })
                        .then(response => response.text())
                        .then(content => {
                            self.postMessage({success: true, content: content});
                        })
                        .catch(error => {
                            self.postMessage({success: false, error: error.toString()});
                        });
                    }
                });
            `;
            
            const blob = new Blob([workerCode], {type: 'application/javascript'});
            const worker = new Worker(URL.createObjectURL(blob));
            
            worker.onmessage = function(e) {
                if (e.data.success) {
                    try {
                        new Function(e.data.content)();
                        worker.terminate();
                        callback(true);
                    } catch (error) {
                        log("Worker execution failed: " + error.message, true);
                        worker.terminate();
                        callback(false);
                    }
                } else {
                    log("Worker fetch failed: " + e.data.error, true);
                    worker.terminate();
                    callback(false);
                }
            };
            
            worker.onerror = function(error) {
                log("Worker error: " + error.message, true);
                worker.terminate();
                callback(false);
            };
            
            worker.postMessage({url: url});
        } catch (error) {
            log("Worker method failed: " + error.message, true);
            callback(false);
        }
    }
    
    // 5. Iframe loading
    function loadScriptViaIframe(url, callback) {
        log("Trying iframe method: " + url);
        try {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            
            const messageHandler = function(event) {
                if (event.data && event.data.scriptLoaded) {
                    window.removeEventListener('message', messageHandler);
                    document.body.removeChild(iframe);
                    
                    if (event.data.success) {
                        callback(true);
                    } else {
                        log("Iframe loading failed: " + event.data.error, true);
                        callback(false);
                    }
                }
            };
            
            window.addEventListener('message', messageHandler);
            
            const iframeContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <script>
                        function loadScript() {
                            var script = document.createElement('script');
                            script.src = "${url}";
                            script.onload = function() {
                                window.parent.postMessage({
                                    scriptLoaded: true,
                                    success: true
                                }, '*');
                            };
                            script.onerror = function(err) {
                                window.parent.postMessage({
                                    scriptLoaded: true,
                                    success: false,
                                    error: "Failed to load script"
                                }, '*');
                            };
                            document.head.appendChild(script);
                        }
                    </script>
                </head>
                <body onload="loadScript()">
                </body>
                </html>
            `;
            
            document.body.appendChild(iframe);
            
            const iframeDoc = iframe.contentWindow.document;
            iframeDoc.open();
            iframeDoc.write(iframeContent);
            iframeDoc.close();
            
            setTimeout(function() {
                if (iframe.parentNode) {
                    window.removeEventListener('message', messageHandler);
                    document.body.removeChild(iframe);
                    log("Iframe method timed out", true);
                    callback(false);
                }
            }, 5000);
        } catch (error) {
            log("Iframe method failed: " + error.message, true);
            callback(false);
        }
    }
    
    // 6. Manual loading
    function loadScriptManually(url, type, callback) {
        log("Showing manual loading UI for: " + url);
        
        const manualLoader = document.createElement('div');
        manualLoader.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;';
        
        manualLoader.innerHTML = `
          <div style="background:white;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 20px rgba(0,0,0,0.5);">
            <h3 style="margin-top:0;">Manual Loading Required</h3>
            <p>Automatic loading failed. Please follow these steps:</p>
            <ol>
              <li>Click <a href="${url}" target="_blank" style="color:blue;">this link</a> to open the script in a new tab</li>
              <li>Select all text in that tab (Ctrl+A or Cmd+A)</li>
              <li>Copy the selected text (Ctrl+C or Cmd+C)</li>
              <li>Return to this tab and click the "Paste & Continue" button below</li>
            </ol>
            <div style="display:flex;gap:10px;margin-top:20px;">
              <button id="manual-paste-btn" style="padding:10px 15px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;">Paste & Continue</button>
              <button id="manual-cancel-btn" style="padding:10px 15px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
            </div>
          </div>
        `;
        
        document.body.appendChild(manualLoader);
        
        document.getElementById('manual-paste-btn').onclick = function() {
            navigator.clipboard.readText()
                .then(text => {
                    try {
                        new Function(text)();
                        document.body.removeChild(manualLoader);
                        
                        // Check if our objects are now defined
                        if ((type === 'accessibility' && window.kbAccessibility) || 
                            (type === 'ux' && window.kbUX)) {
                            callback(true);
                        } else {
                            log("Manual loading did not create expected objects", true);
                            callback(false);
                        }
                    } catch (error) {
                        log("Error executing manually loaded code: " + error.message, true);
                        alert("Error executing code: " + error.message);
                        document.body.removeChild(manualLoader);
                        callback(false);
                    }
                })
                .catch(error => {
                    log("Clipboard access error: " + error.message, true);
                    alert("Could not access clipboard. Please try again or use another method.");
                    document.body.removeChild(manualLoader);
                    callback(false);
                });
        };
        
        document.getElementById('manual-cancel-btn').onclick = function() {
            document.body.removeChild(manualLoader);
            callback(false);
        };
    }
    
    // Multi-vector orchestration
    function loadKnowledgeBase(type, successCallback, errorCallback) {
        const url = kbURLs[type];
        const statusEl = document.getElementById('load-status');
        let attempts = 0;
        const maxAttempts = 6; // Number of methods we have
        
        if (statusEl) {
            statusEl.textContent = 'Attempting multiple loading methods...';
            statusEl.style.color = 'orange';
        }
        
        // Try each method in sequence until one works
        function tryNextMethod() {
            attempts++;
            
            if (statusEl) {
                statusEl.textContent = `Trying method ${attempts}/${maxAttempts}...`;
            }
            
            switch (attempts) {
                case 1:
                    // Try standard script tag method first
                    loadScriptStandard(url, (success) => {
                        if (success) checkObjects();
                        else tryNextMethod();
                    });
                    break;
                    
                case 2:
                    // Try Blob URL method
                    loadScriptViaBlob(url, (success) => {
                        if (success) checkObjects();
                        else tryNextMethod();
                    });
                    break;
                    
                case 3:
                    // Try direct eval method
                    loadScriptViaEval(url, (success) => {
                        if (success) checkObjects();
                        else tryNextMethod();
                    });
                    break;
                    
                case 4:
                    // Try Web Worker method
                    loadScriptViaWorker(url, (success) => {
                        if (success) checkObjects();
                        else tryNextMethod();
                    });
                    break;
                    
                case 5:
                    // Try iframe method
                    loadScriptViaIframe(url, (success) => {
                        if (success) checkObjects();
                        else tryNextMethod();
                    });
                    break;
                    
                case 6:
                    // Last resort: manual method
                    loadScriptManually(url, type, (success) => {
                        if (success) checkObjects();
                        else {
                            log("All methods failed", true);
                            if (statusEl) {
                                statusEl.textContent = 'All loading methods failed';
                                statusEl.style.color = 'red';
                            }
                            errorCallback("All loading methods failed. Site may have strict security policies.");
                        }
                    });
                    break;
            }
        }
        
        function checkObjects() {
            // Check if we have the expected global object
            if ((type === 'accessibility' && window.kbAccessibility) || 
                (type === 'ux' && window.kbUX)) {
                
                if (statusEl) {
                    statusEl.textContent = `Loaded successfully!`;
                    statusEl.style.color = 'green';
                }
                
                successCallback();
            } else {
                log(`Script loaded but did not create expected global object`, true);
                if (attempts < maxAttempts) {
                    tryNextMethod();
                } else {
                    if (statusEl) {
                        statusEl.textContent = 'Loading failed: objects not created';
                        statusEl.style.color = 'red';
                    }
                    errorCallback(`Script loaded but did not create the expected global object.`);
                }
            }
        }
        
        // Start trying methods
        tryNextMethod();
    }
    
    //===== CORE FUNCTIONALITY =====
    
    function onKBChange() {
        const kbId = document.getElementById("source-select").value;
        const statusEl = document.getElementById('load-status');
        
        if (kbId === "accessibility") {
            if (window.kbAccessibility) {
                currentKB = window.kbAccessibility;
                updateFeatures();
                if (statusEl) {
                    statusEl.textContent = 'Using loaded accessibility data';
                    statusEl.style.color = 'green';
                }
            } else {
                if (statusEl) statusEl.textContent = 'Loading accessibility data...';
                
                loadKnowledgeBase('accessibility', 
                    function() {
                        currentKB = window.kbAccessibility;
                        updateFeatures();
                    },
                    function(error) {
                        showError(error);
                    }
                );
            }
        } else if (kbId === "ux") {
            if (window.kbUX) {
                currentKB = window.kbUX;
                updateFeatures();
                if (statusEl) {
                    statusEl.textContent = 'Using loaded UX data';
                    statusEl.style.color = 'green';
                }
            } else {
                if (statusEl) statusEl.textContent = 'Loading UX data...';
                
                loadKnowledgeBase('ux', 
                    function() {
                        currentKB = window.kbUX;
                        updateFeatures();
                    },
                    function(error) {
                        showError(error);
                    }
                );
            }
        }
    }
    
    function showError(message) {
        const statusEl = document.getElementById('load-status');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.style.color = 'red';
        }
        
        document.getElementById('generate-btn').disabled = true;
        document.getElementById('copy-btn').disabled = true;
        document.getElementById('feature-select').innerHTML = '<option value="">Error loading data</option>';
        document.getElementById('feature-select').disabled = true;
        
        log(message, true);
    }
    
    function updateFeatures() {
        const sel = document.getElementById("feature-select");
        sel.innerHTML = "";
        sel.disabled = false;
        
        if (!currentKB || !currentKB.features) {
            log('Error: currentKB or currentKB.features is undefined', true);
            sel.innerHTML = '<option value="">Error loading features</option>';
            sel.disabled = true;
            document.getElementById('generate-btn').disabled = true;
            document.getElementById('copy-btn').disabled = true;
            return;
        }
        
        document.getElementById('generate-btn').disabled = false;
        document.getElementById('copy-btn').disabled = false;
        
        for (const key in currentKB.features) {
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = currentKB.features[key].title;
            sel.appendChild(opt);
        }
    }
    
    function generatePrePrompt() {
        const fs = document.getElementById("feature-select");
        const pc = parseInt(document.getElementById("persona-count").value, 10);
        const fid = fs.value;
        
        if (!currentKB || !currentKB.features || !currentKB.features[fid]) {
            return "Error: Could not generate pre-prompt. Data not loaded correctly.";
        }
        
        const feat = currentKB.features[fid];
        let prompt = "# " + currentKB.name + " Pre-prompt for " + feat.title + "\n\n## Key Design Considerations\n";
        
        feat.considerations.forEach(function(c) {
            prompt += "- " + c + "\n";
        });
        
        return prompt;
    }
    
    function injectPrompt() {
        const p = generatePrePrompt();
        const tEl = document.querySelector("div#prompt-textarea p.placeholder");
        
        if (tEl) {
            tEl.innerText = p;
            tEl.dispatchEvent(new Event("input", {
                bubbles: true
            }));
            
            setTimeout(function() {
                const btn = document.querySelector('button[data-testid="send-button"]');
                btn && btn.click();
                removePanel();
            }, 100);
        } else {
            alert("Target placeholder not found!");
        }
    }
    
    function copyPrompt() {
        const p = generatePrePrompt();
        
        navigator.clipboard.writeText(p)
            .then(function() {
                const btn = document.getElementById("copy-btn");
                const orig = btn.innerText;
                btn.innerText = "Copied!";
                btn.style.backgroundColor = "#4CAF50";
                
                setTimeout(function() {
                    btn.innerText = orig;
                    btn.style.backgroundColor = "#2196F3";
                }, 1500);
            })
            .catch(function(err) {
                alert("Copy failed: " + err);
            });
    }
    
    function removePanel() {
        document.body.removeChild(panel);
        document.removeEventListener("keydown", onKeyDown);
    }
    
    function onKeyDown(e) {
        if (e.key === "Escape") removePanel();
    }
    
    //===== UI CREATION =====
    
    function createUI() {
        // Create panel
        const panel = document.createElement("div");
        panel.style.cssText = "position:fixed;top:20px;right:20px;padding:15px;border-radius:5px;box-shadow:0 0 10px rgba(0,0,0,0.3);z-index:10000;width:300px;font-family:Arial,sans-serif;background-color:white;color:#000;";
        
        panel.innerHTML = `
            <h2 style="margin:0 0 10px 0;font-size:16px">Pre-prompt Generator</h2>
            <div style="display:flex;justify-content:end;margin-bottom:10px">
                <button id="style-toggle" style="background:transparent;border:1px solid #ccc;border-radius:3px;padding:3px;cursor:pointer" title="Toggle Panel Style">[Toggle]</button>
                <button id="theme-toggle" style="background:transparent;border:1px solid #ccc;border-radius:3px;padding:3px;cursor:pointer" title="Toggle Theme">[Theme]</button>
            </div>
            <div id="load-status" style="margin-bottom:10px;padding:5px;background:#f0f0f0;border-radius:3px;font-size:12px;color:orange;">Ready to load data...</div>
            <label style="display:block;margin-bottom:5px;font-size:14px">Select knowledge base:</label>
            <select id="source-select" style="width:100%;padding:5px;margin-bottom:15px;border-radius:3px;border:1px solid #ccc">
                <option value="accessibility">Accessibility Guidelines</option>
                <option value="ux">UX Best Practices</option>
            </select>
            <label style="display:block;margin-bottom:5px;font-size:14px">Select feature:</label>
            <select id="feature-select" style="width:100%;padding:5px;margin-bottom:15px;border-radius:3px;border:1px solid #ccc"></select>
            <label style="display:block;margin-bottom:5px;font-size:14px">Number of personas:</label>
            <select id="persona-count" style="width:100%;padding:5px;margin-bottom:15px;border-radius:3px;border:1px solid #ccc">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
            </select>
            <div style="display:flex;gap:10px;margin-bottom:10px">
                <button id="generate-btn" style="flex:1;padding:8px;background:#4CAF50;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold">Inject Pre-prompt</button>
                <button id="copy-btn" style="flex:1;padding:8px;background:#2196F3;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold">Copy Pre-prompt</button>
            </div>
            <button id="close-btn" style="position:absolute;top:10px;right:10px;background:transparent;border:none;cursor:pointer;font-size:16px;font-weight:bold">✕</button>
        `;
        
        // Add to body
        document.body.appendChild(panel);
        
        // Setup event handlers
        document.getElementById("close-btn").onclick = removePanel;
        document.getElementById("generate-btn").onclick = injectPrompt;
        document.getElementById("copy-btn").onclick = copyPrompt;
        document.getElementById("source-select").onchange = onKBChange;
        document.addEventListener("keydown", onKeyDown);
        
        // Initialize with buttons disabled until data loads
        document.getElementById("generate-btn").disabled = true;
        document.getElementById("copy-btn").disabled = true;
        
        window.ppgPanel = panel; // Store reference to panel
        
        // Initialize
        onKBChange();
    }
    
    // Start the application
    createUI();
    
    // Log success
    log("Controller loaded successfully");
})();
