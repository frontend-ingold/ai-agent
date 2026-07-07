export async function calculator(expression) {

    let result;

    try {

        result = eval(expression);

    } catch {

        return {

            success: false,

            error: "Invalid expression"

        };

    }

    return {

        success: true,

        tool: "calculator",

        result

    };

}