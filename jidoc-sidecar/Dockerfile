FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -B verify package

FROM eclipse-temurin:21-jre
RUN groupadd --system --gid 10001 idocguard \
    && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent \
      --shell /usr/sbin/nologin idocguard \
    && mkdir -p /var/lib/sap-idoc-guard \
    && chown idocguard:idocguard /var/lib/sap-idoc-guard
WORKDIR /app
COPY --from=build --chown=idocguard:idocguard \
  /build/target/sap-idoc-guard-sidecar.jar /app/sap-idoc-guard-sidecar.jar
ENV PORT=8080
USER idocguard
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=8s --start-period=20s --retries=3 \
  CMD ["java", "-cp", "/app/sap-idoc-guard-sidecar.jar", "com.logali.idocguard.HealthCheck"]
ENTRYPOINT ["java", "-Djava.library.path=/opt/sap/idoc", "-cp", "/app/sap-idoc-guard-sidecar.jar:/opt/sap/idoc/*", "com.logali.idocguard.Main"]
