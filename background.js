chrome.action.onClicked.addListener(tab=>chrome.tabs.create({url:chrome.runtime.getURL('controller.html')+'?tabId='+tab.id}));
