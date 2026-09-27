ThisBuild / scalaVersion := "3.8.4"
ThisBuild / organization := "com.transport"
ThisBuild / version      := "0.1.0-SNAPSHOT"

lazy val root = (project in file("."))
  .settings(
    name := "backend",
    libraryDependencies ++= Seq(
      "org.scalatra"        %% "scalatra-javax"          % "3.2.1",
      "org.scalatra"        %% "scalatra-json-javax"     % "3.2.1",
      "org.scalatra"        %% "scalatra-jetty-javax"    % "3.2.1",
      // scalatra-json-javax declara json4s-jackson y json4s-native con scope
      // provided: el backend JSON lo elige la aplicacion. Sin esto falta
      // org.json4s.jackson.JsonMethods y no compila JacksonJsonOutput.
      "io.github.json4s"    %% "json4s-jackson"          % "4.1.1",
      "org.mariadb.jdbc"     % "mariadb-java-client"     % "3.5.1",
      "com.typesafe"         % "config"                  % "1.4.9",
      "com.auth0"            % "java-jwt"                % "4.6.1",
      "ch.qos.logback"       % "logback-classic"         % "1.6.4",
      "org.scalatest"       %% "scalatest"               % "3.2.20" % Test
    ),
    scalacOptions ++= Seq("-deprecation", "-feature", "-unchecked"),
    Test / fork := true,
    // El fork de los tests no hereda el entorno en esta maquina, asi que
    // AERONET_DB_URL no llegaba y la suite de integracion corria contra la base
    // de desarrollo, que el propio spec rechaza. Se reenvian a mano.
    Test / envVars ++= sys.env.collect {
      case (k, v) if k.startsWith("AERONET_") => k -> v
    }
  )
