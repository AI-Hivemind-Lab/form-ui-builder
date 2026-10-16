#!/usr/bin/env node
// A stand-in for the LiteLLM endpoint, for trying the AI review without a real model.
// Usage: node scripts/mock-llm.mjs [port]   then set LITELLM_BASE_URL=http://localhost:<port>/v1, LITELLM_API_KEY=x, JUDGE_MODEL=mock
// It answers from simple keyword rules over the facts it is sent. It is not a model.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4010);

function answer(system, userText) {
  const user = JSON.parse(userText.split('\n\nYour previous answer')[0]);
  if (system.includes('find the investor type question')) {
    const cand = (user.candidates ?? []).find((c) => /type of (subscriber|investor)/i.test(c.label) && !c.formPf);
    if (!cand) return { found: false };
    const isIndividual = (l) => /^(individual$|joint|tenants|individual retirement|keogh)/i.test(l);
    const individual = cand.options.filter((o) => isIndividual(o.label)).map((o) => ({ label: o.label, optionAlias: o.alias }));
    const entity = cand.options.filter((o) => !isIndividual(o.label) && !/^other/i.test(o.label)).map((o) => ({ label: o.label, optionAlias: o.alias }));
    return { found: true, source: 'picklist', selectionMode: 'checkbox', existingGroupAlias: cand.alias, individual, entity, unplaced: [], evidence: { page: cand.page ?? 1, quote: cand.label.slice(0, 120) }, confidence: 'high' };
  }
  if (system.includes('signature widgets on ONE PDF page')) {
    const name = (a) => (/gp/i.test(a) ? 'General Partner Signatory' : /spouse/i.test(a) ? 'Spouse Signatory' : /witness/i.test(a) ? 'Witness Signatory' : /custodian/i.test(a) ? 'Custodian Signatory' : /entity/i.test(a) ? 'Authorized Signatory' : /indi/i.test(a) ? 'Individual Signatory' : null);
    const signatures = user.signatures.filter((s) => name(s.alias)).map((s) => ({ signatureAlias: s.alias, signerName: name(s.alias), role: /gp/i.test(s.alias) ? 'GpSignature' : 'LpSignature', evidence: { page: user.page, quote: user.text.slice(0, 80) || 'signature block' }, confidence: 'high' }));
    const type = (a) => (/^date_/i.test(a) ? 'Date' : /^(signername|printname)_/i.test(a) ? 'Name' : /^(signertitle|title|position)_/i.test(a) ? 'Title' : null);
    const fields = user.fields.filter((f) => type(f.alias)).map((f) => ({ fieldAlias: f.alias, signatureAlias: f.nearSignature, type: type(f.alias), description: null, evidence: { page: user.page, quote: f.label || f.alias }, confidence: 'medium' }));
    return { signatures, fields };
  }
  if (system.includes('information the sub-doc asks for in several places')) {
    const named = user.fields.filter((f) => f.label);
    const primary = named.find((f) => /^\d+\.\s*name of subscriber/i.test(f.label)) ?? named[0];
    if (!primary) return { merge: [], prefilled: [] };
    const merge = named.filter((f) => f !== primary && /subscriber name/i.test(f.label)).map((f) => f.alias);
    const prefilled = user.fields.filter((f) => !f.label).slice(0, 4).map((f) => ({ alias: f.alias, sourceAlias: primary.alias, reason: 'Repeats the subscriber name on a signature page.', evidence: { page: f.page ?? 1, quote: 'name' }, confidence: 'high' }));
    return { merge: merge.length ? [{ primaryAlias: primary.alias, mergedAliases: merge, reason: 'Always shown for every investor.', evidence: { page: primary.page ?? 1, quote: primary.label.slice(0, 80) }, confidence: 'high' }] : [], prefilled };
  }
  if (system.includes('pages that show a full-page PDF should hold only')) {
    const target = (user.targets ?? []).find((t) => /general information/i.test(t.title));
    if (!target) return { moves: [] };
    return { moves: user.pages.map((p) => ({ fromPage: p.page, aliases: p.fields.map((f) => f.alias), targetPage: target.page, wrapperTitle: 'Subscriber Information', reason: 'Fields under a full-page PDF are easy to miss.', confidence: 'high' })) };
  }
  if (system.includes('postal addresses')) return { expand: user.fields.filter((f) => /mailing|residence|registered/i.test(f.label)).map((f) => ({ alias: f.alias, reason: 'A postal address of the subscriber.', confidence: 'high' })) };
  if (system.includes('optional by their nature')) return { optional: user.fields.filter((f) => /^(fax|facsimile|attention)/i.test(f.label)).map((f) => ({ alias: f.alias, reason: 'Many people have no fax or attention line.', confidence: 'medium' })) };
  if (system.includes('acronym or abbreviation')) return { acronyms: [] };
  return {};
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { messages } = JSON.parse(body);
      const content = JSON.stringify(answer(messages[0].content, messages[1].content));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch (e) {
      res.statusCode = 400;
      res.end(String(e));
    }
  });
}).listen(port, () => console.log(`mock LLM on http://localhost:${port}/v1`));
