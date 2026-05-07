const PLATFORM_QUICK_ACTIONS = {
  openclaw: [
    { id: 'models-list',   label: 'List Models',   command: ['openclaw', 'models', 'list'] },
    { id: 'status',        label: 'Check Status',  command: ['openclaw', 'status'] },
    { id: 'channels-list', label: 'List Channels', command: ['openclaw', 'channels', 'list'] },
    { id: 'cache-clear',   label: 'Clear Cache',   command: ['openclaw', 'cache', 'clear'] },
  ],
};

export function getQuickActions(platformId) {
  return PLATFORM_QUICK_ACTIONS[(platformId || '').toLowerCase()] || [];
}
