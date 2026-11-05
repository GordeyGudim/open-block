#include <iostream>

int main() {
    int n;
    std::cout << "Введите n: ";
    std::cin >> n;

    long long fact = 1;
    for (int i = 2; i <= n; i++) {
        fact *= i;
    }

    if (n < 0) {
        std::cout << "Ошибка: n < 0";
    } else {
        std::cout << "n! = " << fact;
    }
    return 0;
}
