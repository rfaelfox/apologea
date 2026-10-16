#!/usr/bin/env node
// Ersatz für die Claude-Code-Kommandozeile in Tests. Verhalten über FAKE_CLAUDE_MODE: ok | alter | twice | notool
import fs from 'node:fs';
const args = process.argv.slice(2);
const prefix = 'mcp__claude_ai_MarketPrint__Print_On_Demand__';
if (args[0] === '--version') { console.log('9.9.9 (Claude Code – Test)'); process.exit(0); }
if (args[0] === 'mcp' && args[1] === 'list') { console.log('Checking MCP server health…\n\nclaude.ai MarketPrint: Print On Demand: https://mcp.marketprint.test/mcp (HTTP) - ✓ Connected'); process.exit(0); }
const input = fs.readFileSync(0, 'utf8');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const tools = ['get_account_info', 'list_base_products', 'get_base_product_details', 'list_my_images', 'upload_image', 'create_shop_product'].map((t) => prefix + t);
emit({ type: 'system', subtype: 'init', tools, mcp_servers: [{ name: 'claude.ai MarketPrint: Print On Demand', status: 'connected' }], model: 'test' });
const toolMatch = input.match(/Werkzeug `([a-z_]+)`/);
const jsonMatch = input.match(/```json\n([\s\S]*?)\n```/);
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
if (toolMatch && mode !== 'notool') {
  const tool = toolMatch[1];
  let callArgs = JSON.parse(jsonMatch[1]);
  if (mode === 'alter') callArgs = { ...callArgs, price: 1 };
  const results = {
    get_account_info: { authenticated: true, accountId: 'fake', email: 'test@apologea.invalid', shopDomains: ['dfz1mp-1u.myshopify.com'] },
    create_shop_product: { draftId: 'draft-123', publishedTo: callArgs.addToShops, listingImages: ['https://cdn.marketprint.de/x.png'] },
    list_my_images: { images: [{ imageId: 'img-9', fileName: 'motiv.png' }] },
  };
  const n = mode === 'twice' ? 2 : 1;
  for (let i = 0; i < n; i++) {
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu' + i, name: prefix + tool, input: callArgs }] } });
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu' + i, content: [{ type: 'text', text: JSON.stringify(results[tool] || { ok: true }) }] }] } });
  }
}
emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'FERTIG' }] } });
emit({ type: 'result', subtype: 'success', is_error: false, result: 'FERTIG' });
