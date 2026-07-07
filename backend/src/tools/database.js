export async function database(query) {

    return {

        success: true,

        tool: "database",

        result: `Database query: ${query}`

    };

}