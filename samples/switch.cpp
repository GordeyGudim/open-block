#include <iostream>

int main() {
    int x;
    std::cin >> x;

    switch (x) {
        case 1:
            std::cout << "один";
            break;
        case 2:
            std::cout << "два";
            break;
        default:
            std::cout << "другое";
    }
    return 0;
}
