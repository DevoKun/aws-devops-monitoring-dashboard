#!/usr/bin/env node
/**********************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                                *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

import { CfnPolicy, Effect, IRole, Policy, PolicyStatement } from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as cdk from '@aws-cdk/core';


export enum QuickSightSetup {
    DATA_SET = 'dataset',
    DATA_SOURCE = 'datasource',
    ANALYSIS = 'analysis',
    DASHBOARD = 'dashboard',
    ALL = 'all'
}

export interface QuickSightProps {
    readonly name: string;
    readonly description: string;
    readonly resource: QuickSightSetup;
    readonly sourceTemplateArn: string;
    readonly principalArn: string;
    readonly workgroupName: string;
    readonly logLevel: string;
    readonly role: IRole;
    readonly parentStackName: string;
    readonly userAgentExtra: string;
}
export class QuickSight extends cdk.Construct {
    private _analysisURL: string;
    private _dashboardURL: string;

    constructor(scope: cdk.Construct, id: string, props: QuickSightProps) {
        super(scope, id);
        const qsCreateResource = this.createCustomResource(props);
        this._analysisURL = qsCreateResource.getAtt('analysis_url').toString();
        this._dashboardURL = qsCreateResource.getAtt('dashboard_url').toString();
    }

    private createCustomResource(props: QuickSightProps): cdk.CustomResource {
        const customResourcePolicy = new Policy(this, 'QSCustomResourcePolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "quicksight:CreateAnalysis",
                        "quicksight:DeleteAnalysis",
                        "quicksight:CreateDataSet",
                        "quicksight:DeleteDataSet",
                        "quicksight:CreateDataSource",
                        "quicksight:DeleteDataSource",
                        "quicksight:UpdateDataSource",
                        "quicksight:UpdateDataSourcePermissions",
                        "quicksight:Describe*",
                        "quicksight:Get*",
                        "quicksight:List*",
                        "quicksight:PassDataSet",
                        "quicksight:PassDataSource",
                        "quicksight:RestoreAnalysis",
                        "quicksight:SearchAnalyses",
                        "quicksight:CreateDashboard",
                        "quicksight:DeleteDashboard"
                    ],
                    resources: [`arn:${cdk.Aws.PARTITION}:quicksight:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*/*`]
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["quicksight:DescribeTemplate"],
                    resources: [props.sourceTemplateArn]
                })
            ]
        });
        (customResourcePolicy.node.defaultChild as CfnPolicy).cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W12',
                    reason: 'The DescribeTemplate API call requires the resource to \'*\' in us-east-1.'
                }]
            }
        };

        customResourcePolicy.attachToRole(props.role);

        const customResourceFunction = new lambda.Function(this, 'CustomResource', {
            runtime: lambda.Runtime.PYTHON_3_8,
            handler: 'lambda_function.handler',
            description: 'AWS DevOps Monitoring Dashboard Solution - This function creates Amazon QuickSight resources.',
            role: props.role,
            code: lambda.Code.fromAsset('lambda/quicksight-custom-resources'),
            timeout: cdk.Duration.seconds(30),
            environment: {
                UserAgentExtra: props.userAgentExtra
            }
        });
        customResourceFunction.node.addDependency(customResourcePolicy);

        const refCustomResourceFunction =  customResourceFunction.node.findChild('Resource') as lambda.CfnFunction;
        refCustomResourceFunction.cfnOptions.metadata = {
                cfn_nag: {
                    rules_to_suppress: [
                        {
                            id: 'W89',
                            reason: 'There is no need to run this lambda in a VPC'
                        },
                        {
                            id: 'W92',
                            reason: 'There is no need for Reserved Concurrency'
                        }
                    ]
                }
        };

        const customResource = new cdk.CustomResource(this, 'QuickSightResources', {
            serviceToken: customResourceFunction.functionArn,
            properties: {
                Resource: props.resource,
                ApplicationName: props.name,
                StackName: props.parentStackName,
                LogLevel: props.logLevel,
                QuickSightSourceTemplateArn: props.sourceTemplateArn,
                QuickSightPrincipalArn: props.principalArn,
                WorkGroupName: props.workgroupName
            },
            resourceType: 'Custom::QuickSightResources'
        });

        customResource.node.addDependency(customResourcePolicy);
        return customResource;
    }

    public get analysisURL(): string {
        return this._analysisURL;
    }

    public get dashboardURL(): string {
        return this._dashboardURL;
    }
}