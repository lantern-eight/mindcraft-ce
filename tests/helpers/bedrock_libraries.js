// SPDX-License-Identifier: CC0-1.0
// Whether the libraries that play Bedrock Edition are installed. Only the bedrock branch pins them, so on
// main a test that needs them is skipped, with this as the reason. Use it as `{ skip: needsBedrockLibraries }`.
import { bedrockLibrariesInstalled } from '../../src/agent/bedrock/connect.js';

export const needsBedrockLibraries = bedrockLibrariesInstalled()
    ? false
    : 'needs the Bedrock Edition libraries, which the bedrock branch pins';
