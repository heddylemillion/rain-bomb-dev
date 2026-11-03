import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, ROOT_DIR } from '../src/server/config.js';
import { KnowledgeBaseSchema } from '../src/server/services/chatService.js';

const expectedTopics = [
  'emergency-kit',
  'documents-medicines',
  'electrical-safety',
  'avoid-floodwater',
  'move-belongings',
  'family-plan',
  'extra-help',
  'pets',
  'after-flood',
  'lightning-safety',
  'risk-levels',
];

const config = loadConfig();
const file = path.join(ROOT_DIR, 'config', 'kb.preparedness.th.json');
const knowledge = KnowledgeBaseSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')) as unknown);
if (config.chat.requireApprovedAdvisories) {
  const approvedTopics = new Set(
    knowledge.items.filter((item) => item.status === 'approved').map((item) => item.topic)
  );
  const missingTopics = expectedTopics.filter((topic) => !approvedTopics.has(topic));
  if (missingTopics.length) {
    throw new Error(`Knowledge base topics require review: ${missingTopics.join(', ')}`);
  }
  if (knowledge.emergencyContacts.length === 0) {
    throw new Error('At least one official emergency contact must be reviewed before live use.');
  }
}

console.log('Preparedness knowledge base schema and live approval gate passed.');
