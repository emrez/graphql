/* eslint-disable @typescript-eslint/ban-ts-comment */
import { mergeTypeDefs } from "@graphql-tools/merge";
import { GraphQLSchema, print, GraphQLResolveInfo, ObjectTypeDefinitionNode, visit } from "graphql";
import { SchemaComposer } from "graphql-compose";
import cypherQuery from "./cypher-query";
import * as neo4j from "../neo4j";
import { lowFirstLetter } from "../utils";

interface Input {
    typeDefs: any;
    resolvers?: any;
}

function makeAugmentedSchema(input: Input): GraphQLSchema {
    const document = mergeTypeDefs(Array.isArray(input.typeDefs) ? input.typeDefs : [input.typeDefs]);

    const composer = new SchemaComposer();

    function createObjectType(definition: ObjectTypeDefinitionNode) {
        if (["Query", "Mutation", "Subscription"].includes(definition.name.value)) {
            // TODO
            return;
        }

        const node = composer.createObjectTC(
            print({
                kind: "Document",
                definitions: [definition],
            })
        );

        const looseArgs = definition.fields?.reduce((res, v) => {
            const name = v.name?.value;
            const { type } = node.getField(name);

            let looseType = type.getTypeName();

            looseType = looseType.replace(/!/g, "");

            return {
                ...res,
                [name]: looseType,
            };
        }, {});

        composer.Query.addFields({
            [definition.name.value]: {
                type: `[${definition.name.value}]!`,
                resolve: async (_: any, args: any, context: any, resolveInfo: GraphQLResolveInfo) => {
                    const { driver } = context;

                    if (!driver) {
                        throw new Error("context.driver missing");
                    }

                    const [cypher, params] = cypherQuery(args, context, resolveInfo);

                    const result = await neo4j.query({ cypher, params, driver });

                    return result.map((r) => r[lowFirstLetter(definition.name.value)]);
                },
                args: looseArgs,
            },
        });
    }

    const visitor = {
        ObjectTypeDefinition: createObjectType,
    };

    visit(document, { enter: visitor });

    return composer.buildSchema();
}

export default makeAugmentedSchema;