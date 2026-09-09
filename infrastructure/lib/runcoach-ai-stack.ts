import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export class RunCoachAiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new cdk.aws_lambda.Function(this, "RunCoachApiLambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: cdk.aws_lambda.Code.fromInline(
        `exports.handler = async () => ({ statusCode: 200, body: JSON.stringify({ ok: true, app: 'RunCoach AI' }) });`,
      ),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
    });

    const gateway = new cdk.aws_apigateway.LambdaRestApi(
      this,
      "RunCoachApiGateway",
      {
        handler: api,
        proxy: true,
        deployOptions: {
          stageName: "prod",
        },
      },
    );

    new cdk.CfnOutput(this, "ApiUrl", {
      value: gateway.url,
      description: "Base URL for the RunCoach API",
    });
  }
}
