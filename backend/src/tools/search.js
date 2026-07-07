import { tavilySearch } from "../providers/tavily.js";

export async function search(query) {

    const data = await tavilySearch(query);

    if (data.error) {

        return {

            success: false,

            error: data.error

        };

    }

    return {

        success: true,

        tool: "search",

        result: data

    };

}