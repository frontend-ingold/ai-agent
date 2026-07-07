import { search } from "./tools/search.js";
import { calculator } from "./tools/calculator.js";
import { database } from "./tools/database.js";
import { system } from "./tools/system.js";

export async function executeTool(plan) {

    switch (plan.tool) {

        case "search":

            return await search(plan.query);

        case "calculator":

            return await calculator(plan.expression);

        case "system":

            return await system(plan.operation);

        case "database":

            return await database(plan.query);

        default:

            return {

                success: false,

                error: "Unknown Tool"

            };

    }

}