#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { RunCoachAiStack } from "../lib/runcoach-ai-stack";

const app = new cdk.App();
new RunCoachAiStack(app, "RunCoachAiStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-west-1",
  },
});
