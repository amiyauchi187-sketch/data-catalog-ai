// Claude で回答を作る（Answerer の本番用）。

import { buildContextJson } from './build-context.ts';
import { buildAnswerJsonSchema, type Answerer } from './answer-schema.ts';
import { callStructured, type MessagesClient } from './claude-call.ts';
import type { QaModel } from './models.ts';
import { ANSWERER_SYSTEM_PROMPT, buildAnswererMessage } from './prompt.ts';

export function createClaudeAnswerer(client: MessagesClient, model: QaModel): Answerer {
  return {
    answer(question, datasets) {
      return callStructured(client, {
        model,
        effort: 'medium',
        maxTokens: 8000,
        system: ANSWERER_SYSTEM_PROMPT,
        user: buildAnswererMessage(question, buildContextJson(datasets)),
        schema: buildAnswerJsonSchema(datasets.map((d) => d.id)),
      });
    },
  };
}
